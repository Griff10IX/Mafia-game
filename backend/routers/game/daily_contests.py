"""Contest events API: active / mine / previous."""
from fastapi import APIRouter, Depends, Query

from server import db, get_current_user
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_EVENTS


async def _events_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_EVENTS)


_rl = [Depends(_events_sustained_rl_user)]


async def get_contest_active(current_user: dict = Depends(get_current_user)):
    from utils.daily_contests import serialize_active

    return await serialize_active(db, current_user.get("id"))


async def get_contest_mine(current_user: dict = Depends(get_current_user)):
    from utils.daily_contests import serialize_mine

    return {"wins": await serialize_mine(db, current_user.get("id") or "")}


async def get_contest_previous(
    current_user: dict = Depends(get_current_user),
    limit: int = Query(24, ge=1, le=48),
):
    from utils.daily_contests import serialize_previous

    return {"events": await serialize_previous(db, limit=limit)}


def register(router: APIRouter):
    router.add_api_route("/contests/active", get_contest_active, methods=["GET"], dependencies=_rl)
    router.add_api_route("/contests/mine", get_contest_mine, methods=["GET"], dependencies=_rl)
    router.add_api_route("/contests/previous", get_contest_previous, methods=["GET"], dependencies=_rl)
