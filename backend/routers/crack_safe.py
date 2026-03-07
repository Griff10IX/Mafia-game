# Crack the Safe: jackpot game. Every attempt costs 1M. No free entries, no purchasable extra. Admins unlimited.
from datetime import datetime, timezone
import random
from typing import List

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, get_current_user_verified, _is_admin, log_activity

SAFE_ENTRY_COST = 1_000_000
SAFE_JACKPOT_SEED = 5_000_000
SAFE_JACKPOT_PER_ATTEMPT = 1_000_000  # Jackpot increases by exactly 1M per attempt
SAFE_DIGITS = 5
SAFE_MIN = 1
SAFE_MAX = 9


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
    async def crack_safe_info(user: dict = Depends(get_current_user_verified)):
        safe = await _get_or_create_safe()
        combo = safe["combination"]
        total_attempts = safe.get("total_attempts", 0)
        clues = _generate_clues(combo, total_attempts)
        is_admin = _is_admin(user)

        user_money = int(user.get("money") or 0)
        can_guess = is_admin or user_money >= SAFE_ENTRY_COST

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
                "is_admin": True,
                "admin_combination": combo,
            }
            return response

        return {
            "jackpot": safe.get("jackpot", SAFE_JACKPOT_SEED),
            "total_attempts": total_attempts,
            "last_winner_username": safe.get("last_winner_username"),
            "last_won_at": safe.get("last_won_at").isoformat() if safe.get("last_won_at") else None,
            "can_guess": can_guess,
            "next_guess_at": None,
            "entry_cost": SAFE_ENTRY_COST,
            "clues": clues,
            "is_admin": False,
        }

    @router.post("/crack-safe/guess")
    async def crack_safe_guess(req: SafeGuessRequest, user: dict = Depends(get_current_user_verified)):
        safe = await _get_or_create_safe()
        combo = safe["combination"]
        now = datetime.now(timezone.utc)
        is_admin = _is_admin(user)

        if user.get("money", 0) < SAFE_ENTRY_COST:
            raise HTTPException(status_code=400, detail=f"You need ${SAFE_ENTRY_COST:,} to attempt to crack the safe.")

        await db.users.update_one({"id": user["id"]}, {"$inc": {"money": -SAFE_ENTRY_COST}})

        await db.safe_game.update_one({}, {"$inc": {"jackpot": SAFE_JACKPOT_PER_ATTEMPT, "total_attempts": 1}})

        cracked = req.numbers == combo
        correct_positions = sum(1 for a, b in zip(req.numbers, combo) if a == b)

        await db.safe_guesses.insert_one({
            "user_id": user["id"],
            "username": user.get("username", "?"),
            "guess": req.numbers,
            "guessed_at": now,
            "correct": cracked,
        })
        await log_activity(
            user["id"],
            user.get("username") or "?",
            "crack_safe_guess",
            {"cracked": cracked, "correct_positions": sum(1 for a, b in zip(req.numbers, combo) if a == b), "is_admin": is_admin},
        )

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
            await log_activity(
                user["id"],
                user.get("username") or "?",
                "crack_safe_jackpot",
                {"jackpot_won": jackpot_amount},
            )
            return {
                "cracked": True,
                "correct_positions": SAFE_DIGITS,
                "jackpot_won": jackpot_amount,
                "message": f"YOU CRACKED THE SAFE! ${jackpot_amount:,} is yours!",
            }

        fresh = await db.safe_game.find_one({})
        clues = _generate_clues(fresh["combination"], fresh.get("total_attempts", 0))

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
        }
