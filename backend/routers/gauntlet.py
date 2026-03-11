# The Gauntlet (Flappy-style) — cash rewards by score.
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, log_activity


REWARD_TIERS = [
    {"score": 1, "cash": 250, "label": "Street Punk"},
    {"score": 5, "cash": 1_000, "label": "Corner Boy"},
    {"score": 10, "cash": 2_500, "label": "Made Man"},
    {"score": 20, "cash": 6_000, "label": "Underboss"},
    {"score": 35, "cash": 12_500, "label": "Capo"},
    {"score": 50, "cash": 25_000, "label": "Don"},
]

# Basic sanity limits (frontend is not trusted).
MAX_SCORE_ACCEPTED = 250


def _get_cash_reward(score: int) -> dict:
    reward = {"cash": 0, "label": "Nobody", "tier": -1, "score": 0}
    for i, t in enumerate(REWARD_TIERS):
        if score >= int(t["score"]):
            reward = {"cash": int(t["cash"]), "label": str(t["label"]), "tier": i, "score": int(t["score"])}
    return reward


class GauntletClaimRequest(BaseModel):
    score: int


def register(router):
    @router.post("/gauntlet/claim")
    async def gauntlet_claim(payload: GauntletClaimRequest, current_user: dict = Depends(get_current_user)):
        score = int(payload.score or 0)
        if score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if score > MAX_SCORE_ACCEPTED:
            raise HTTPException(status_code=400, detail="Score too high to claim.")

        reward = _get_cash_reward(score)
        cash = int(reward["cash"] or 0)
        if cash <= 0:
            return {"cash_awarded": 0, "label": reward["label"], "tier": reward["tier"]}

        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": cash}})
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.user_meta.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"gauntlet_last_claim_at": now_iso, "gauntlet_last_score": score, "gauntlet_last_cash": cash}},
            upsert=True,
        )
        try:
            await log_activity(current_user["id"], f"Claimed ${cash:,} from The Gauntlet (score {score}).")
        except Exception:
            pass

        # Return updated balance for immediate UI update.
        user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        return {
            "cash_awarded": cash,
            "label": reward["label"],
            "tier": reward["tier"],
            "score": score,
            "money": int((user_doc or {}).get("money") or 0),
        }

