# Shared sustained page RL dependency for single-player casino ownership/config GETs.
from fastapi import Depends

from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_CASINOS


def casinos_sustained_rl_dependencies(db, get_current_user_callable):
    async def _casinos_sustained_rl_user(current_user: dict = Depends(get_current_user_callable)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_CASINOS)

    return [Depends(_casinos_sustained_rl_user)]
