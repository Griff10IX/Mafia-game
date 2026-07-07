# Entertainer staff: dashboard API (player + admin view)
from typing import Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from utils.entertainer_service import (
    backfill_entertainer_completion_bonuses,
    build_entertainer_admin_summary,
    build_entertainer_dashboard,
    build_entertainers_admin_overview,
    collect_entertainer_pending_to_fund,
    entertainer_perk_label,
    entertainer_utc_today,
    grant_entertainer_perk_tokens,
    send_entertainer_game_broadcast,
)
from utils.sustained_page_ratelimit import PAGE_KEY_ENTERTAINER, check_sustained_page_rl


class EntertainerRewardPerkBody(BaseModel):
    target_username: str = Field(..., min_length=1)
    token_type: str = Field(..., min_length=2)
    amount: int = Field(1, ge=1, le=10)


class EntertainerBroadcastBody(BaseModel):
    template: str = Field("custom", description="new_e_games | mdg | mp_poker | word_hunt | forum | custom")
    title: Optional[str] = Field(None, max_length=120)
    message: Optional[str] = Field(None, max_length=500)


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    send_notification = srv.send_notification
    send_notification_to_all = srv.send_notification_to_all
    log_activity = srv.log_activity
    _is_entertainer = srv._is_entertainer
    require_admin_or_mod = srv.require_admin_or_mod
    _username_pattern = srv._username_pattern

    @router.post("/entertainer/reward-perk")
    async def entertainer_reward_perk(body: EntertainerRewardPerkBody, current_user: dict = Depends(get_current_user)):
        """Grant armoury perk tokens (no Game Pass). Daily caps (UTC): 10 tokens total, max 2 Auto Rank (2h)."""
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")
        target_username = (body.target_username or "").strip()
        if not target_username:
            raise HTTPException(status_code=400, detail="target_username required")
        token_type = (body.token_type or "").strip()
        amount = int(body.amount or 1)
        today = entertainer_utc_today()

        target = await db.users.find_one(
            _username_pattern(target_username),
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_dead"):
            raise HTTPException(status_code=400, detail="Cannot grant perks to a dead player.")

        try:
            await grant_entertainer_perk_tokens(
                db,
                entertainer_id=current_user["id"],
                target_id=target["id"],
                token_type=token_type,
                amount=amount,
                today=today,
            )
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve)) from ve

        label = entertainer_perk_label(token_type)
        ent_name = (current_user.get("username") or "?").strip()
        tgt_name = (target.get("username") or target_username).strip()
        try:
            await send_notification(
                target["id"],
                "Entertainer perk",
                f"You received {amount}× {label} token(s) from Entertainer {ent_name}.",
                "reward",
                category="entertainer",
            )
        except Exception:
            pass
        try:
            await log_activity(
                current_user["id"],
                ent_name,
                "entertainer_perk_grant",
                {
                    "target_username": tgt_name,
                    "target_id": target["id"],
                    "token_type": token_type,
                    "amount": amount,
                },
            )
        except Exception:
            pass

        return {
            "message": f"Granted {amount}× {label} to {tgt_name}.",
            "token_type": token_type,
            "amount": amount,
            "target_username": tgt_name,
        }

    @router.post("/entertainer/broadcast")
    async def entertainer_broadcast(body: EntertainerBroadcastBody, current_user: dict = Depends(get_current_user)):
        """Send a game-wide inbox message about E-Games / Entertainer Forum (max 5 per UTC day)."""
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_ENTERTAINER)
        ent_name = (current_user.get("username") or "?").strip()
        try:
            result = await send_entertainer_game_broadcast(
                db,
                send_notification_to_all,
                entertainer_id=current_user["id"],
                entertainer_name=ent_name,
                template=body.template,
                title=body.title,
                message=body.message,
            )
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve)) from ve
        try:
            await log_activity(
                current_user["id"],
                ent_name,
                "entertainer_broadcast",
                {
                    "template": result.get("template"),
                    "title": result.get("title"),
                    "broadcasts_used_today": result.get("broadcasts_used_today"),
                },
            )
        except Exception:
            pass
        return {
            "message": "Game-wide message sent to all players (respects E-Games notification preference).",
            **result,
        }

    @router.get("/entertainer/dashboard")
    async def entertainer_dashboard_self(current_user: dict = Depends(get_current_user)):
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")
        try:
            await backfill_entertainer_completion_bonuses(
                db,
                entertainer_id=current_user["id"],
                send_notification=send_notification,
            )
        except Exception:
            import logging

            logging.getLogger(__name__).exception(
                "entertainer completion bonus backfill uid=%s", current_user.get("id")
            )
        dash = await build_entertainer_dashboard(db, current_user["id"])
        if not dash:
            raise HTTPException(status_code=403, detail="Entertainer access required")
        return dash

    @router.post("/entertainer/collect-pending-fund")
    async def entertainer_collect_pending_fund(current_user: dict = Depends(get_current_user)):
        """Move pending daily allowance into the spendable entertainer fund (up to fund caps). Idempotent."""
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")
        out = await collect_entertainer_pending_to_fund(db, current_user["id"])
        if not out.get("ok"):
            raise HTTPException(status_code=404, detail=out.get("detail") or "Entertainer not found")
        try:
            await log_activity(
                current_user["id"],
                (current_user.get("username") or "?").strip(),
                "entertainer_collect_pending_fund",
                {
                    "moved_cash": out.get("moved_cash"),
                    "moved_points": out.get("moved_points"),
                    "moved_wallet_points": out.get("moved_wallet_points"),
                },
            )
        except Exception:
            pass
        return out

    @router.get("/admin/entertainer-dashboard")
    async def entertainer_dashboard_admin(
        target_username: str = Query(..., description="Entertainer username to inspect"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        uname = (target_username or "").strip()
        if not uname:
            raise HTTPException(status_code=400, detail="target_username required")
        pat = _username_pattern(uname)
        if not pat:
            raise HTTPException(status_code=400, detail="target_username required")
        target = await db.users.find_one(
            {"username": pat},
            {"_id": 0, "id": 1, "username": 1, "is_entertainer": 1},
        )
        if not target or not target.get("is_entertainer"):
            raise HTTPException(status_code=404, detail="Entertainer not found")
        dash = await build_entertainer_admin_summary(db, target["id"])
        return dash or {}

    @router.get("/admin/entertainers-overview")
    async def entertainers_overview_admin(current_user: dict = Depends(require_admin_or_mod)):
        """All entertainers: fund balances, pending saved pay, completion bonus owed, ledger totals."""
        return await build_entertainers_admin_overview(db)

    @router.post("/admin/entertainer-backfill-completion-bonus")
    async def entertainer_backfill_completion_bonus_admin(
        target_username: Optional[str] = Query(None, description="Optional entertainer username; omit for all"),
        dry_run: bool = Query(False, description="Preview only — no credits"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Credit missed completion bonuses for finished sponsored games (100 pts each, pending)."""
        entertainer_id = None
        if target_username and (target_username or "").strip():
            uname = target_username.strip()
            pat = _username_pattern(uname)
            if not pat:
                raise HTTPException(status_code=400, detail="target_username required")
            target = await db.users.find_one(
                {"username": pat},
                {"_id": 0, "id": 1, "username": 1, "is_entertainer": 1},
            )
            if not target or not target.get("is_entertainer"):
                raise HTTPException(status_code=404, detail="Entertainer not found")
            entertainer_id = target["id"]
        out = await backfill_entertainer_completion_bonuses(
            db,
            entertainer_id=entertainer_id,
            send_notification=send_notification if not dry_run else None,
            dry_run=dry_run,
        )
        try:
            await log_activity(
                current_user["id"],
                (current_user.get("username") or "?").strip(),
                "entertainer_backfill_completion_bonus",
                {
                    "target_username": (target_username or "").strip() or None,
                    "dry_run": dry_run,
                    **{k: out.get(k) for k in ("rows_created", "rows_paid", "points_total", "entertainers_credited")},
                },
            )
        except Exception:
            pass
        return out
