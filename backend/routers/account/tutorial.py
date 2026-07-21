"""New-player tutorial API."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from server import db, get_current_user, _is_admin
from utils.tutorial import (
    TUTORIAL_STEPS,
    TUTORIAL_STATUS_COMPLETED,
    TUTORIAL_STATUS_IN_PROGRESS,
    TUTORIAL_STATUS_PENDING,
    TUTORIAL_STATUS_SKIPPED,
    effective_tutorial_status,
    grant_tutorial_completion_rewards,
    is_tutorial_globally_enabled,
    next_step_after,
    resolve_tutorial_eligibility,
    clear_tutorial_claims_for_user,
    set_tutorial_globally_enabled,
)

logger = logging.getLogger(__name__)


def _client_ip(request: Request) -> str:
    try:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
        if request.client and request.client.host:
            return str(request.client.host)
    except Exception:
        pass
    return ""


def _gate_ok(step: str, user: dict) -> bool:
    if step == "theme":
        return bool(user.get("tutorial_theme_done"))
    if step == "crimes":
        return bool(user.get("tutorial_crime_done"))
    if step == "gta":
        return bool(user.get("tutorial_gta_done"))
    # Informational steps: advance is always allowed
    return True


async def tutorial_status(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    info = await resolve_tutorial_eligibility(
        db, current_user, request_ip=_client_ip(request)
    )
    step = info.get("tutorial_step")
    return {
        **info,
        "steps": list(TUTORIAL_STEPS),
        "can_advance": bool(
            info.get("eligible")
            and info.get("tutorial_status") == TUTORIAL_STATUS_IN_PROGRESS
            and step
            and _gate_ok(step, current_user if step not in ("theme", "crimes", "gta") else {
                **current_user,
                "tutorial_theme_done": info.get("tutorial_theme_done"),
                "tutorial_crime_done": info.get("tutorial_crime_done"),
                "tutorial_gta_done": info.get("tutorial_gta_done"),
            })
        ),
        "loot_box_free_rare_opens": int(current_user.get("loot_box_free_rare_opens") or 0),
    }


async def tutorial_start(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if not await is_tutorial_globally_enabled(db) and not _is_admin(current_user):
        raise HTTPException(
            status_code=400,
            detail="New player tutorial is not enabled yet.",
        )
    info = await resolve_tutorial_eligibility(
        db, current_user, request_ip=_client_ip(request)
    )
    if info.get("tutorial_status") in (TUTORIAL_STATUS_COMPLETED, TUTORIAL_STATUS_SKIPPED) and not info.get("eligible"):
        if info.get("tutorial_ineligible_reason") == "disabled" and not _is_admin(current_user):
            raise HTTPException(
                status_code=400,
                detail="New player tutorial is not enabled yet.",
            )
        if info.get("tutorial_ineligible_reason"):
            raise HTTPException(
                status_code=400,
                detail="Tutorial already completed or unavailable for this email/IP.",
            )
        if info.get("tutorial_status") == TUTORIAL_STATUS_COMPLETED:
            raise HTTPException(status_code=400, detail="Tutorial already completed")
        raise HTTPException(status_code=400, detail="Tutorial was skipped")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
                "tutorial_step": "theme",
                "tutorial_started_at": now_iso,
                "tutorial_ineligible_reason": None,
            }
        },
    )
    return {
        "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
        "tutorial_step": "theme",
        "message": "Tutorial started",
    }


async def tutorial_replay(
    current_user: dict = Depends(get_current_user),
):
    """
    Replay the tutorial from the start (sidebar → Information → Tutorial).
    Never clears reward claims or tutorial_rewards_granted — completion rewards
    are one-time and are not granted again.
    """
    if effective_tutorial_status(current_user) == TUTORIAL_STATUS_IN_PROGRESS:
        return {
            "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
            "tutorial_step": current_user.get("tutorial_step") or "theme",
            "message": "Tutorial is already running",
        }
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
                "tutorial_step": "theme",
                "tutorial_crime_done": False,
                "tutorial_gta_done": False,
                "tutorial_theme_done": False,
                "tutorial_ineligible_reason": None,
                "tutorial_replay": True,
                "tutorial_started_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {
        "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
        "tutorial_step": "theme",
        "message": "Tutorial restarted. Completion rewards are one-time — you won't receive them again.",
    }


async def tutorial_skip(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    info = await resolve_tutorial_eligibility(
        db, current_user, request_ip=_client_ip(request)
    )
    if info.get("tutorial_status") == TUTORIAL_STATUS_COMPLETED:
        return {"tutorial_status": TUTORIAL_STATUS_COMPLETED, "message": "Already completed"}
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "tutorial_status": TUTORIAL_STATUS_SKIPPED,
                "tutorial_skipped_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"tutorial_status": TUTORIAL_STATUS_SKIPPED, "message": "Tutorial skipped"}


class TutorialAdvanceBody(BaseModel):
    ack: Optional[bool] = True
    theme_done: Optional[bool] = None


async def tutorial_advance(
    request: Request,
    body: TutorialAdvanceBody = TutorialAdvanceBody(),
    current_user: dict = Depends(get_current_user),
):
    info = await resolve_tutorial_eligibility(
        db, current_user, request_ip=_client_ip(request)
    )
    if info.get("tutorial_status") != TUTORIAL_STATUS_IN_PROGRESS:
        if info.get("tutorial_status") == TUTORIAL_STATUS_PENDING:
            raise HTTPException(status_code=400, detail="Start the tutorial first")
        raise HTTPException(status_code=400, detail="Tutorial is not in progress")

    fresh = await db.users.find_one({"id": current_user["id"]}, {"_id": 0}) or current_user
    step = (fresh.get("tutorial_step") or "theme").strip()
    if step not in TUTORIAL_STEPS:
        step = "theme"

    if body.theme_done and step == "theme":
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"tutorial_theme_done": True}},
        )
        fresh["tutorial_theme_done"] = True

    if not _gate_ok(step, fresh):
        if step == "crimes":
            raise HTTPException(status_code=400, detail="Commit a crime to continue")
        if step == "gta":
            raise HTTPException(status_code=400, detail="Attempt a GTA to continue")
        if step == "theme":
            raise HTTPException(status_code=400, detail="Pick a theme to continue")
        raise HTTPException(status_code=400, detail="Step requirements not met")

    nxt = next_step_after(step)
    if nxt is None:
        # Final step → complete + rewards
        rewards = await grant_tutorial_completion_rewards(
            db, fresh, request_ip=_client_ip(request)
        )
        return {
            "tutorial_status": TUTORIAL_STATUS_COMPLETED,
            "tutorial_step": "missions",
            "completed": True,
            "rewards": rewards,
            "redirect": rewards.get("redirect"),
        }

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"tutorial_step": nxt}},
    )
    return {
        "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
        "tutorial_step": nxt,
        "completed": False,
    }


class AdminTutorialResetBody(BaseModel):
    username: str
    clear_claims: bool = False
    auto_start: bool = True


async def admin_tutorial_reset(
    body: AdminTutorialResetBody,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    un = (body.username or "").strip()
    if not un:
        raise HTTPException(status_code=400, detail="Username required")
    target = await db.users.find_one(
        {"username": {"$regex": f"^{un}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    cleared = 0
    if body.clear_claims:
        cleared = await clear_tutorial_claims_for_user(db, target)
    set_doc = {
        "tutorial_status": TUTORIAL_STATUS_PENDING,
        "tutorial_step": None,
        "tutorial_crime_done": False,
        "tutorial_gta_done": False,
        "tutorial_theme_done": False,
        "tutorial_rewards_granted": False,
        "tutorial_ineligible_reason": None,
    }
    unset_doc = {
        "tutorial_started_at": "",
        "tutorial_completed_at": "",
        "tutorial_skipped_at": "",
    }
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": set_doc, "$unset": unset_doc},
    )
    started = False
    if body.auto_start:
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
                    "tutorial_step": "theme",
                    "tutorial_started_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        started = True
    return {
        "message": f"Tutorial reset for {target.get('username')}",
        "username": target.get("username"),
        "claims_cleared": cleared,
        "started": started,
        "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS if started else TUTORIAL_STATUS_PENDING,
    }


async def admin_tutorial_start_for_me(
    clear_claims: bool = False,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if clear_claims:
        await clear_tutorial_claims_for_user(db, current_user)
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
                "tutorial_step": "theme",
                "tutorial_crime_done": False,
                "tutorial_gta_done": False,
                "tutorial_theme_done": False,
                "tutorial_rewards_granted": False,
                "tutorial_ineligible_reason": None,
                "tutorial_started_at": datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {
                "tutorial_completed_at": "",
                "tutorial_skipped_at": "",
            },
        },
    )
    return {
        "message": "Tutorial started on your account (works even while globally disabled)",
        "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
        "tutorial_step": "theme",
        "tutorial_enabled": await is_tutorial_globally_enabled(db),
    }


class AdminTutorialSettingsBody(BaseModel):
    enabled: bool


async def admin_tutorial_get_settings(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = await is_tutorial_globally_enabled(db)
    return {
        "enabled": enabled,
        "message": (
            "Tutorial is ON for new eligible players"
            if enabled
            else "Tutorial is OFF — use Run on my account / Reset to test"
        ),
    }


async def admin_tutorial_set_settings(
    body: AdminTutorialSettingsBody,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = await set_tutorial_globally_enabled(db, bool(body.enabled))
    return {
        "enabled": enabled,
        "message": (
            "New player tutorial enabled for eligible new accounts"
            if enabled
            else "New player tutorial disabled (admin test still works)"
        ),
    }


def register(router):
    router.add_api_route("/tutorial/status", tutorial_status, methods=["GET"])
    router.add_api_route("/tutorial/start", tutorial_start, methods=["POST"])
    router.add_api_route("/tutorial/skip", tutorial_skip, methods=["POST"])
    router.add_api_route("/tutorial/replay", tutorial_replay, methods=["POST"])
    router.add_api_route("/tutorial/advance", tutorial_advance, methods=["POST"])
    router.add_api_route("/admin/tutorial/reset", admin_tutorial_reset, methods=["POST"])
    router.add_api_route("/admin/tutorial/start-for-me", admin_tutorial_start_for_me, methods=["POST"])
    router.add_api_route("/admin/tutorial/settings", admin_tutorial_get_settings, methods=["GET"])
    router.add_api_route("/admin/tutorial/settings", admin_tutorial_set_settings, methods=["POST"])
