# Crack the Safe: jackpot game. Each attempt costs SAFE_ENTRY_COST. After a win, 24h lock unless you pay
# SAFE_REPLAY_COST (max SAFE_REPLAY_MAX_PER_DAY per UTC day). Admins unlimited / no win lock.
# Reward pool: cash jackpot (always) + 25% chance for 1 bonus token (Crimes XP, GTA XP, Melt, etc.)
from datetime import datetime, timedelta, timezone
import secrets
_rng = secrets.SystemRandom()
from typing import List, Optional

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, get_current_user_verified, _is_admin, log_activity

# Token types that can drop as bonus reward (matches armoury TOKEN_TYPES)
SAFE_TOKEN_REWARD_TYPES = (
    "xp_crimes", "xp_gta", "melt", "oc_reduced", "booze", "racket", "travel", "properties", "jailbust_bonus"
)
SAFE_TOKEN_REWARD_CHANCE = 0.25  # 25% chance for bonus tokens on win
SAFE_TOKEN_REWARD_MIN_TYPES = 1   # 1–3 different token types
SAFE_TOKEN_REWARD_MAX_TYPES = 3
SAFE_TOKEN_REWARD_MIN_AMOUNT = 1  # 1–2 per type
SAFE_TOKEN_REWARD_MAX_AMOUNT = 2

# 75% reduction for beta
SAFE_ENTRY_COST = 250_000
SAFE_JACKPOT_SEED = 1_250_000
SAFE_JACKPOT_PER_ATTEMPT = 250_000  # Jackpot increases by exactly 250K per attempt
SAFE_DIGITS = 5
SAFE_MIN = 1
SAFE_MAX = 9
SAFE_GUESS_COOLDOWN_SECONDS = 10
SAFE_WIN_LOCK_HOURS = 24
SAFE_REPLAY_COST = 15_000_000
SAFE_REPLAY_MAX_PER_DAY = 3


def _as_utc_dt(v) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)
    if isinstance(v, str):
        s = v.replace("Z", "+00:00")
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            return None
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    return None


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
        combo = [_rng.randint(SAFE_MIN, SAFE_MAX) for _ in range(SAFE_DIGITS)]
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
    if not combo:
        return []
    even_count = sum(1 for n in combo if n % 2 == 0)
    total_sum = sum(combo)
    high = max(combo)
    first = combo[0] if combo else 0
    return [
        {"id": 1, "unlocked": True, "text": f"There are {even_count} even number{'s' if even_count != 1 else ''}", "unlock_after": 0},
        {"id": 2, "unlocked": total_attempts >= 5, "text": f"The sum of all numbers is {total_sum}", "unlock_after": 5},
        {"id": 3, "unlocked": total_attempts >= 15, "text": f"The highest number is {high}", "unlock_after": 15},
        {"id": 4, "unlocked": total_attempts >= 30, "text": f"The first number is {first}", "unlock_after": 30},
    ]


def register(router):
    @router.get("/crack-safe/info")
    async def crack_safe_info(user: dict = Depends(get_current_user_verified)):
        safe = await _get_or_create_safe()
        combo = safe.get("combination") or []
        total_attempts = safe.get("total_attempts", 0)
        clues = _generate_clues(combo, total_attempts)
        is_admin = _is_admin(user)

        user_money = int(user.get("money") or 0)
        can_guess = is_admin or user_money >= SAFE_ENTRY_COST

        limit = 25 if is_admin else 5
        winners_cursor = db.safe_winners.find({}).sort("won_at", -1).limit(limit)
        winners = []
        async for w in winners_cursor:
            winners.append({
                "username": w.get("username", "?"),
                "won_at": w["won_at"].isoformat() if w.get("won_at") else None,
                "amount_won": w.get("amount_won"),
            })
        if not winners and safe.get("last_winner_username"):
            winners = [{
                "username": safe.get("last_winner_username") or "?",
                "won_at": safe["last_won_at"].isoformat() if safe.get("last_won_at") else None,
                "amount_won": None,
            }]

        # Possible rewards for UI key (cash + token types)
        _token_desc = {
            "xp_crimes": "2x XP from crimes, 1h",
            "xp_gta": "2x XP from GTA, 1h",
            "melt": "Reduced melt cooldown, 1h",
            "oc_reduced": "Reduced OC cost & cooldown, 1h",
            "booze": "Cheaper booze, 1h",
            "racket": "Increased racket profit, 1h",
            "travel": "Cheaper & faster travel, 1h",
            "properties": "3x property income, 1h",
            "jailbust_bonus": "+10% bust success, 1h",
        }
        possible_rewards = [{"id": "cash", "name": "Cash Jackpot", "desc": "Full jackpot amount (always)"}]
        for t in SAFE_TOKEN_REWARD_TYPES:
            name = t.replace("_", " ").title() + " Token"
            desc = (_token_desc.get(t, "1h bonus") + " — 1–3 types, 1–2 each (25% chance)")
            possible_rewards.append({"id": t, "name": name, "desc": desc})

        cd = user.get("crack_safe_cooldown_until")
        now = datetime.now(timezone.utc)
        next_guess_at = None
        cd_dt = _as_utc_dt(cd)
        if not is_admin and cd_dt and cd_dt > now:
            next_guess_at = cd_dt.isoformat()

        win_lock_dt = _as_utc_dt(user.get("crack_safe_win_lock_until"))
        win_locked = bool(not is_admin and win_lock_dt and win_lock_dt > now)
        win_lock_until_iso = win_lock_dt.isoformat() if win_locked else None

        day_key = now.strftime("%Y-%m-%d")
        replay_day = user.get("crack_safe_replay_day")
        replay_count_stored = int(user.get("crack_safe_replay_count") or 0)
        replays_today = replay_count_stored if replay_day == day_key else 0
        replay_slots_remaining = max(0, SAFE_REPLAY_MAX_PER_DAY - replays_today)

        can_guess = is_admin or (user_money >= SAFE_ENTRY_COST and not win_locked)

        base = {
            "jackpot": safe.get("jackpot", SAFE_JACKPOT_SEED),
            "total_attempts": total_attempts,
            "last_winner_username": safe.get("last_winner_username"),
            "last_won_at": safe.get("last_won_at").isoformat() if safe.get("last_won_at") else None,
            "last_winners": winners,
            "can_guess": can_guess if not is_admin else True,
            "next_guess_at": next_guess_at,
            "entry_cost": SAFE_ENTRY_COST,
            "clues": clues,
            "is_admin": is_admin,
            "possible_rewards": possible_rewards,
            "win_locked": win_locked,
            "win_lock_until": win_lock_until_iso,
            "replay_cost": SAFE_REPLAY_COST,
            "replay_max_per_day": SAFE_REPLAY_MAX_PER_DAY,
            "replays_used_today": replays_today,
            "replay_slots_remaining": replay_slots_remaining,
            "can_afford_replay": user_money >= SAFE_REPLAY_COST,
        }
        if is_admin:
            base["admin_combination"] = combo
        return base

    @router.post("/crack-safe/unlock-replay")
    async def crack_safe_unlock_replay(user: dict = Depends(get_current_user_verified)):
        """Pay SAFE_REPLAY_COST to clear post-win 24h lock. Max SAFE_REPLAY_MAX_PER_DAY per UTC day."""
        if _is_admin(user):
            return {"ok": True, "message": "Admins are not locked out."}
        uid = user.get("id") or ""
        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        # Atomic: money, active win lock, replay cap (UTC day) — avoids double-spend / over-count races
        replay_filter = {
            "id": uid,
            "money": {"$gte": SAFE_REPLAY_COST},
            "crack_safe_win_lock_until": {"$gt": now},
            "$expr": {
                "$lt": [
                    {
                        "$cond": {
                            "if": {"$eq": ["$crack_safe_replay_day", day_key]},
                            "then": {"$ifNull": ["$crack_safe_replay_count", 0]},
                            "else": 0,
                        }
                    },
                    SAFE_REPLAY_MAX_PER_DAY,
                ]
            },
        }
        pipeline = [
            {
                "$set": {
                    "money": {"$subtract": ["$money", SAFE_REPLAY_COST]},
                    "crack_safe_win_lock_until": None,
                    "crack_safe_replay_day": day_key,
                    "crack_safe_replay_count": {
                        "$cond": {
                            "if": {"$eq": ["$crack_safe_replay_day", day_key]},
                            "then": {"$add": [{"$ifNull": ["$crack_safe_replay_count", 0]}, 1]},
                            "else": 1,
                        }
                    },
                }
            }
        ]
        res = await db.users.update_one(replay_filter, pipeline)
        if res.modified_count == 0:
            udoc = await db.users.find_one({"id": uid}, {"money": 1, "crack_safe_win_lock_until": 1, "crack_safe_replay_day": 1, "crack_safe_replay_count": 1})
            if not udoc:
                raise HTTPException(status_code=400, detail="User not found.")
            if int(udoc.get("money") or 0) < SAFE_REPLAY_COST:
                raise HTTPException(status_code=400, detail=f"You need ${SAFE_REPLAY_COST:,} to buy another attempt.")
            wld = _as_utc_dt(udoc.get("crack_safe_win_lock_until"))
            if not wld or wld <= now:
                raise HTTPException(status_code=400, detail="You don't have an active post-win cooldown. Play normally.")
            prev_day = udoc.get("crack_safe_replay_day")
            cnt = int(udoc.get("crack_safe_replay_count") or 0)
            used = cnt if prev_day == day_key else 0
            if used >= SAFE_REPLAY_MAX_PER_DAY:
                raise HTTPException(
                    status_code=400,
                    detail=f"You've used all {SAFE_REPLAY_MAX_PER_DAY} paid replays today (UTC). Wait until tomorrow or until your free timer ends.",
                )
            raise HTTPException(status_code=400, detail="Could not process replay purchase. Try again.")

        fresh = await db.users.find_one({"id": uid}, {"crack_safe_replay_count": 1, "crack_safe_replay_day": 1})
        cnt_after = int((fresh or {}).get("crack_safe_replay_count") or 0)
        await log_activity(
            uid,
            user.get("username") or "?",
            "crack_safe_replay_purchase",
            {"cost": SAFE_REPLAY_COST, "replays_today_after": cnt_after},
        )
        return {
            "ok": True,
            "message": f"Cooldown cleared for ${SAFE_REPLAY_COST:,}. You can crack the safe again (entry fee still applies).",
            "replays_used_today": cnt_after,
            "replay_slots_remaining": max(0, SAFE_REPLAY_MAX_PER_DAY - cnt_after),
        }

    @router.post("/crack-safe/guess")
    async def crack_safe_guess(req: SafeGuessRequest, user: dict = Depends(get_current_user_verified)):
        safe = await _get_or_create_safe()
        combo = safe.get("combination") or []
        now = datetime.now(timezone.utc)
        is_admin = _is_admin(user)
        uid = user.get("id") or ""
        fresh = await db.users.find_one({"id": uid}) or user

        if not is_admin:
            wld = _as_utc_dt(fresh.get("crack_safe_win_lock_until"))
            if wld and wld > now:
                remaining = int((wld - now).total_seconds()) + 1
                h, rem = divmod(remaining, 3600)
                m, s = divmod(rem, 60)
                raise HTTPException(
                    status_code=400,
                    detail=f"You cracked the safe recently. Wait {h}h {m}m {s}s or pay ${SAFE_REPLAY_COST:,} to play again (max {SAFE_REPLAY_MAX_PER_DAY}/day).",
                )
            cd = fresh.get("crack_safe_cooldown_until")
            cd_dt = _as_utc_dt(cd)
            if cd_dt and cd_dt > now:
                remaining = int((cd_dt - now).total_seconds()) + 1
                raise HTTPException(status_code=400, detail=f"Wait {remaining}s before your next guess.")

        cooldown_until = now + timedelta(seconds=SAFE_GUESS_COOLDOWN_SECONDS)
        result = await db.users.update_one(
            {"id": uid, "money": {"$gte": SAFE_ENTRY_COST}},
            {"$inc": {"money": -SAFE_ENTRY_COST}, "$set": {"crack_safe_cooldown_until": cooldown_until}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"You need ${SAFE_ENTRY_COST:,} to attempt to crack the safe.")

        await db.safe_game.update_one({}, {"$inc": {"jackpot": SAFE_JACKPOT_PER_ATTEMPT, "total_attempts": 1}})

        cracked = req.numbers == combo
        correct_positions = sum(1 for a, b in zip(req.numbers, combo) if a == b)

        await db.safe_guesses.insert_one({
            "user_id": user.get("id") or "",
            "username": user.get("username", "?"),
            "guess": req.numbers,
            "guessed_at": now,
            "correct": cracked,
        })
        await log_activity(
            user.get("id") or "",
            user.get("username") or "?",
            "crack_safe_guess",
            {"cracked": cracked, "correct_positions": sum(1 for a, b in zip(req.numbers, combo) if a == b), "is_admin": is_admin},
        )

        if cracked:
            uid = user.get("id") or ""
            new_combo = [_rng.randint(SAFE_MIN, SAFE_MAX) for _ in range(SAFE_DIGITS)]
            won_safe = await db.safe_game.find_one_and_update(
                {"combination": combo},
                {"$set": {
                    "combination": new_combo,
                    "jackpot": SAFE_JACKPOT_SEED,
                    "total_attempts": 0,
                    "last_winner_username": user.get("username", "?"),
                    "last_won_at": now,
                }},
            )
            if not won_safe:
                return {
                    "cracked": False,
                    "correct_positions": SAFE_DIGITS,
                    "message": "Safe was cracked by someone else just before you!",
                }
            jackpot_amount = won_safe.get("jackpot", SAFE_JACKPOT_SEED)
            if is_admin:
                await db.users.update_one({"id": uid}, {"$inc": {"money": jackpot_amount}})
            else:
                await db.users.update_one(
                    {"id": uid},
                    {
                        "$inc": {"money": jackpot_amount},
                        "$set": {"crack_safe_win_lock_until": now + timedelta(hours=SAFE_WIN_LOCK_HOURS)},
                    },
                )

            bonus_tokens = []
            if _rng.random() < SAFE_TOKEN_REWARD_CHANCE:
                try:
                    from routers.kill.armoury import TOKEN_CONFIG
                    types_list = list(SAFE_TOKEN_REWARD_TYPES)
                    num_types = _rng.randint(SAFE_TOKEN_REWARD_MIN_TYPES, SAFE_TOKEN_REWARD_MAX_TYPES)
                    chosen = _rng.sample(types_list, min(num_types, len(types_list)))
                    incs = {}
                    for token_type in chosen:
                        cfg = TOKEN_CONFIG.get(token_type)
                        if cfg:
                            amt = _rng.randint(SAFE_TOKEN_REWARD_MIN_AMOUNT, SAFE_TOKEN_REWARD_MAX_AMOUNT)
                            count_field = cfg["count_field"]
                            incs[count_field] = incs.get(count_field, 0) + amt
                            bonus_tokens.append({"token_type": token_type, "amount": amt})
                    if incs:
                        await db.users.update_one({"id": uid}, {"$inc": incs})
                except Exception:
                    pass
            await db.safe_winners.insert_one({
                "username": user.get("username", "?"),
                "user_id": uid,
                "won_at": now,
                "amount_won": jackpot_amount,
                "bonus_tokens": bonus_tokens,
            })
            await log_activity(
                uid,
                user.get("username") or "?",
                "crack_safe_jackpot",
                {"jackpot_won": jackpot_amount, "bonus_tokens": bonus_tokens},
            )
            msg = f"YOU CRACKED THE SAFE! ${jackpot_amount:,} is yours!"
            if bonus_tokens:
                parts = [f"{b['amount']} {b['token_type'].replace('_', ' ').title()}" for b in bonus_tokens]
                msg += f" Plus {'; '.join(parts)} token(s)!"
            return {
                "cracked": True,
                "correct_positions": SAFE_DIGITS,
                "jackpot_won": jackpot_amount,
                "bonus_tokens": bonus_tokens,
                "message": msg,
            }

        fresh = await db.safe_game.find_one({})
        clues = _generate_clues(fresh.get("combination") or [], fresh.get("total_attempts", 0))

        # Only sometimes reveal how many digits were in the correct position (randomly, not every attempt)
        show_position_hint = _rng.random() < 0.5
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
