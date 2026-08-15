# Crack the Safe: jackpot game. Each attempt costs SAFE_ENTRY_COST. After a win, 24h lock unless you pay
# SAFE_REPLAY_COST (max SAFE_REPLAY_MAX_PER_DAY per UK calendar day). Admins unlimited / no win lock.
# Reward pool: cash jackpot (always) + 25% chance for 1 bonus token + 25% chance for 10–15 loot box pieces
# + 2% chance for 1 mission skip or robot bodyguard token
from datetime import datetime, timedelta, timezone
import asyncio
import logging
import secrets
_rng = secrets.SystemRandom()
from typing import List, Optional

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, get_current_user_verified, _is_admin, log_activity
from utils.game_timezone import game_today_date_str

logger = logging.getLogger(__name__)

_crack_safe_bookkeeping_locks: dict = {}
_crack_safe_bookkeeping_tasks: set = set()


def _spawn_crack_safe_bookkeeping(user_id: str, coro_factory) -> None:
    """Run coro_factory() in the background, serialized per user."""
    lock = _crack_safe_bookkeeping_locks.setdefault(user_id or "", asyncio.Lock())

    async def _runner():
        async with lock:
            try:
                await coro_factory()
            except Exception:
                logger.exception("crack safe post-guess bookkeeping failed user_id=%s", user_id)

    task = asyncio.create_task(_runner())
    _crack_safe_bookkeeping_tasks.add(task)
    task.add_done_callback(_crack_safe_bookkeeping_tasks.discard)

# Token types that can drop as bonus reward (matches armoury TOKEN_TYPES)
SAFE_TOKEN_REWARD_TYPES = (
    "xp_crimes", "xp_gta", "auto_rank_2h", "melt", "oc_reduced", "booze", "racket", "travel", "properties", "jailbust_bonus",
)
SAFE_RARE_TOKEN_TYPES = ("mission_skip", "robot_bodyguard_hire")
SAFE_TOKEN_COUNT_FIELDS = {
    "mission_skip": "mission_skip_tokens",
    "robot_bodyguard_hire": "robot_bodyguard_hire_tokens",
}
SAFE_TOKEN_REWARD_CHANCE = 0.25  # 25% chance for bonus tokens on win
SAFE_RARE_TOKEN_CHANCE = 0.02  # 2% chance for 1 mission skip or robot bodyguard
SAFE_TOKEN_REWARD_MIN_TYPES = 1   # exactly 1 token type
SAFE_TOKEN_REWARD_MAX_TYPES = 1
SAFE_TOKEN_REWARD_MIN_AMOUNT = 1  # 1–2 total tokens
SAFE_TOKEN_REWARD_MAX_AMOUNT = 2
SAFE_LOOT_REWARD_CHANCE = 0.25
SAFE_LOOT_PIECES_OPTIONS = (10, 15)

SAFE_ENTRY_COST = 15_000_000
SAFE_JACKPOT_SEED = 500_000_000
SAFE_JACKPOT_PER_ATTEMPT = 250_000  # Each wrong guess adds this to the jackpot (entry fee stays separate)
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
    # One-time bump: legacy seeds migrate to the current floor.
    if safe:
        jp = int(safe.get("jackpot") or 0)
        if jp < SAFE_JACKPOT_SEED:
            await db.safe_game.update_one({"_id": safe["_id"]}, {"$set": {"jackpot": SAFE_JACKPOT_SEED}})
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
    def _clue_row(idx: int, unlock_after: int, solved_text: str):
        unlocked = total_attempts >= unlock_after
        return {
            "id": idx,
            "unlocked": unlocked,
            "text": solved_text if unlocked else None,
            "unlock_after": unlock_after,
        }
    return [
        _clue_row(1, 0, f"There are {even_count} even number{'s' if even_count != 1 else ''}"),
        _clue_row(2, 5, f"The sum of all numbers is {total_sum}"),
        _clue_row(3, 15, f"The highest number is {high}"),
        _clue_row(4, 30, f"The first number is {first}"),
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
            "auto_rank_2h": "Auto Rank access, 2h",
            "melt": "Reduced melt cooldown, 1h",
            "oc_reduced": "Reduced OC cost & cooldown, 1h",
            "booze": "Cheaper booze, 1h",
            "racket": "Increased racket profit, 1h",
            "travel": "Cheaper & faster travel, 1h",
            "properties": "3x property income, 1h",
            "jailbust_bonus": "+10% bust success, 1h",
            "mission_skip": "Skip one mission",
            "robot_bodyguard_hire": "Hire one robot bodyguard",
        }
        _token_names = {
            "mission_skip": "Mission Skip Token",
            "robot_bodyguard_hire": "Free Robot Bodyguard Token",
        }
        possible_rewards = [{"id": "cash", "name": "Cash Jackpot", "desc": "Full jackpot amount (always)"}]
        possible_rewards.append({
            "id": "loot_pieces",
            "name": "Loot Box Pieces",
            "desc": f"{SAFE_LOOT_PIECES_OPTIONS[0]} or {SAFE_LOOT_PIECES_OPTIONS[1]} pieces ({int(SAFE_LOOT_REWARD_CHANCE * 100)}% chance)",
        })
        for t in SAFE_TOKEN_REWARD_TYPES:
            name = _token_names.get(t) or (t.replace("_", " ").title() + " Token")
            desc = (_token_desc.get(t, "1h bonus") + " — 1–2 tokens (25% chance)")
            possible_rewards.append({"id": t, "name": name, "desc": desc})
        rare_pct = max(1, int(round(SAFE_RARE_TOKEN_CHANCE * 100)))
        for t in SAFE_RARE_TOKEN_TYPES:
            name = _token_names.get(t) or (t.replace("_", " ").title() + " Token")
            desc = (_token_desc.get(t, "rare token") + f" — 1 token (rare, {rare_pct}% chance)")
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

        day_key = game_today_date_str(now)
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
        day_key = game_today_date_str(now)
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
        uname = user.get("username") or "?"

        async def _post_guess_log():
            await db.safe_guesses.insert_one({
                "user_id": uid,
                "username": uname,
                "guess": req.numbers,
                "guessed_at": now,
                "correct": cracked,
            })
            await log_activity(
                uid,
                uname,
                "crack_safe_guess",
                {"cracked": cracked, "correct_positions": correct_positions, "is_admin": is_admin},
            )

        _spawn_crack_safe_bookkeeping(uid, _post_guess_log)

        if cracked:
            new_combo = [_rng.randint(SAFE_MIN, SAFE_MAX) for _ in range(SAFE_DIGITS)]
            won_safe = await db.safe_game.find_one_and_update(
                {"combination": combo},
                {"$set": {
                    "combination": new_combo,
                    "jackpot": SAFE_JACKPOT_SEED,
                    "total_attempts": 0,
                    "last_winner_username": uname,
                    "last_won_at": now,
                }},
            )
            if not won_safe:
                return {
                    "cracked": False,
                    "correct_positions": SAFE_DIGITS,
                    "message": "Safe was cracked by someone else just before you!",
                    "refetch": True,
                }
            jackpot_amount = won_safe.get("jackpot", SAFE_JACKPOT_SEED)
            win_lock_until = now + timedelta(hours=SAFE_WIN_LOCK_HOURS)
            win_inc: dict = {"money": jackpot_amount}
            bonus_tokens = []
            bonus_loot_pieces = 0
            if _rng.random() < SAFE_LOOT_REWARD_CHANCE:
                bonus_loot_pieces = _rng.choice(SAFE_LOOT_PIECES_OPTIONS)
                win_inc["loot_box_pieces"] = bonus_loot_pieces
            if is_admin:
                await db.users.update_one({"id": uid}, {"$inc": win_inc})
            else:
                await db.users.update_one(
                    {"id": uid},
                    {
                        "$inc": win_inc,
                        "$set": {"crack_safe_win_lock_until": win_lock_until},
                    },
                )

            if _rng.random() < SAFE_TOKEN_REWARD_CHANCE:
                try:
                    from routers.kill.armoury import TOKEN_CONFIG
                    types_list = list(SAFE_TOKEN_REWARD_TYPES)
                    num_types = _rng.randint(SAFE_TOKEN_REWARD_MIN_TYPES, SAFE_TOKEN_REWARD_MAX_TYPES)
                    chosen = _rng.sample(types_list, min(num_types, len(types_list)))
                    incs = {}
                    for token_type in chosen:
                        cfg = TOKEN_CONFIG.get(token_type)
                        count_field = (cfg or {}).get("count_field") or SAFE_TOKEN_COUNT_FIELDS.get(token_type)
                        if not count_field:
                            continue
                        amt = 1 if token_type in SAFE_TOKEN_COUNT_FIELDS else _rng.randint(SAFE_TOKEN_REWARD_MIN_AMOUNT, SAFE_TOKEN_REWARD_MAX_AMOUNT)
                        incs[count_field] = incs.get(count_field, 0) + amt
                        bonus_tokens.append({"token_type": token_type, "amount": amt})
                    if incs:
                        await db.users.update_one({"id": uid}, {"$inc": incs})
                except Exception:
                    pass

            if _rng.random() < SAFE_RARE_TOKEN_CHANCE and SAFE_RARE_TOKEN_TYPES:
                rare_type = _rng.choice(SAFE_RARE_TOKEN_TYPES)
                rare_field = SAFE_TOKEN_COUNT_FIELDS.get(rare_type)
                if rare_field:
                    await db.users.update_one({"id": uid}, {"$inc": {rare_field: 1}})
                    bonus_tokens.append({"token_type": rare_type, "amount": 1})

            async def _post_win_bookkeeping():
                await db.safe_winners.insert_one({
                    "username": uname,
                    "user_id": uid,
                    "won_at": now,
                    "amount_won": jackpot_amount,
                    "bonus_tokens": bonus_tokens,
                    "bonus_loot_pieces": bonus_loot_pieces,
                })
                await log_activity(
                    uid,
                    uname,
                    "crack_safe_jackpot",
                    {"jackpot_won": jackpot_amount, "bonus_tokens": bonus_tokens, "bonus_loot_pieces": bonus_loot_pieces},
                )

            _spawn_crack_safe_bookkeeping(uid, _post_win_bookkeeping)
            msg = f"YOU CRACKED THE SAFE! ${jackpot_amount:,} is yours!"
            if bonus_loot_pieces:
                msg += f" Plus {bonus_loot_pieces:,} loot box pieces!"
            if bonus_tokens:
                parts = [f"{b['amount']} {b['token_type'].replace('_', ' ').title()}" for b in bonus_tokens]
                msg += f" Plus {'; '.join(parts)} token(s)!"
            return {
                "cracked": True,
                "correct_positions": SAFE_DIGITS,
                "jackpot_won": jackpot_amount,
                "bonus_tokens": bonus_tokens,
                "bonus_loot_pieces": bonus_loot_pieces,
                "message": msg,
                "jackpot": SAFE_JACKPOT_SEED,
                "total_attempts": 0,
                "last_winner_username": uname,
                "last_won_at": now.isoformat(),
                "win_locked": not is_admin,
                "win_lock_until": None if is_admin else win_lock_until.isoformat(),
                "next_guess_at": None if is_admin else cooldown_until.isoformat(),
                "can_guess": bool(is_admin),
            }

        fresh_safe = await db.safe_game.find_one({})
        jackpot_now = int((fresh_safe or {}).get("jackpot") or SAFE_JACKPOT_SEED)
        attempts_now = int((fresh_safe or {}).get("total_attempts") or 0)
        clues = _generate_clues((fresh_safe or {}).get("combination") or [], attempts_now)

        # Only sometimes reveal how many digits were in the correct position (randomly, not every attempt)
        show_position_hint = _rng.random() < 0.5
        message = (
            f"Wrong combination. {correct_positions} number{'s' if correct_positions != 1 else ''} in the correct position."
            if show_position_hint
            else "Wrong combination."
        )
        money_after = int(fresh.get("money") or 0) - SAFE_ENTRY_COST
        return {
            "cracked": False,
            "correct_positions": correct_positions if show_position_hint else None,
            "clues": clues,
            "message": message,
            "jackpot": jackpot_now,
            "total_attempts": attempts_now,
            "next_guess_at": None if is_admin else cooldown_until.isoformat(),
            "can_guess": bool(is_admin or money_after >= SAFE_ENTRY_COST),
            "new_balance": money_after,
        }
