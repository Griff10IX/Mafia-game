# Browser-like client checks for minigame API routes and core gameplay routes (same rules as /auth/register + login).
import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from utils.login_user_agent import auth_client_headers_blocked, game_action_strict_headers_blocked
from utils.staff_bot_client_alert import maybe_notify_staff_bot_client_blocked

logger = logging.getLogger(__name__)

# Paths that use the same client probe as auth (UA markers, shape, Sec-Fetch-*).
# Boxing + racing are included; cron/admin racing routes are excluded below.
_MINIGAME_PREFIXES = (
    "/api/minigames",
    "/api/snake",
    "/api/gauntlet",
    "/api/minesweeper",
    "/api/battleships",
    "/api/the-getaway",
    "/api/family-run",
    "/api/whack-a-copper",
    "/api/mafia-rpg",
    "/api/shooting-range",
    "/api/boxing",
    "/api/racing",
)

# Crimes, GTA (steal, garage, melt/scrap, repair-car, marketplace), jail, crew OC, solo organised crime,
# bodyguards (player routes), attack, booze run (buy/sell/config).
_GAME_ACTION_PREFIXES = (
    "/api/crimes",
    "/api/gta",
    "/api/jail",
    "/api/oc",
    "/api/organised-crime",
    "/api/bodyguards",
    "/api/attack",
    "/api/booze-run",
    "/api/account/gambling-self-ban",
    "/api/casino",
    "/api/sports-betting",
)

_FORBIDDEN_DETAIL = "This action must use the official game app or a normal web browser."


def _is_protected_minigame_path(path: str) -> bool:
    if path.startswith("/api/racing/cron/") or path.startswith("/api/racing/admin/"):
        return False
    return any(path.startswith(p) for p in _MINIGAME_PREFIXES)


def _is_protected_game_action_path(path: str) -> bool:
    return any(path.startswith(p) for p in _GAME_ACTION_PREFIXES)


class MinigameClientGuardMiddleware(BaseHTTPMiddleware):
    """Reject script-like clients on minigame and core gameplay endpoints (toggles on main game_settings)."""

    def __init__(self, app, db):
        super().__init__(app)
        self.db = db
        self._settings_doc: dict | None = None
        self._settings_mono: float = 0.0

    async def _main_settings_slice(self) -> dict | None:
        now = time.monotonic()
        if self._settings_doc is not None and (now - self._settings_mono) < 45.0:
            return self._settings_doc
        try:
            self._settings_doc = await self.db.game_settings.find_one(
                {"_id": "main"},
                {
                    "_id": 0,
                    "block_script_user_agent_login": 1,
                    "block_script_user_agent_game_actions": 1,
                    "game_actions_client_strict": 1,
                },
            )
        except Exception:
            logger.exception("MinigameClientGuard: game_settings read failed")
            self._settings_doc = None
        self._settings_mono = now
        return self._settings_doc

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        settings = await self._main_settings_slice()

        if _is_protected_minigame_path(path):
            blocked, reason = auth_client_headers_blocked(request.headers, settings)
            if blocked:
                logger.warning(
                    "Minigame client guard: blocked reason=%s path=%s method=%s",
                    reason,
                    path,
                    request.method,
                )
                try:
                    await maybe_notify_staff_bot_client_blocked(
                        db=self.db,
                        request=request,
                        internal_reason=reason,
                        source="auth_minigames",
                    )
                except Exception:
                    logger.exception("Minigame client guard: staff inbox notify failed")
                return JSONResponse(status_code=403, content={"detail": _FORBIDDEN_DETAIL})
            return await call_next(request)

        if _is_protected_game_action_path(path):
            blocked, reason = auth_client_headers_blocked(
                request.headers,
                settings,
                setting_key="block_script_user_agent_game_actions",
            )
            if blocked:
                logger.warning(
                    "Game action client guard: blocked reason=%s path=%s method=%s",
                    reason,
                    path,
                    request.method,
                )
                try:
                    await maybe_notify_staff_bot_client_blocked(
                        db=self.db,
                        request=request,
                        internal_reason=reason,
                        source="auth_gameplay",
                    )
                except Exception:
                    logger.exception("Game action client guard: staff inbox notify failed")
                return JSONResponse(status_code=403, content={"detail": _FORBIDDEN_DETAIL})
            strict_blocked, strict_reason = game_action_strict_headers_blocked(
                request.headers,
                method=request.method,
                settings=settings,
            )
            if strict_blocked:
                logger.warning(
                    "Game action client guard (strict): blocked reason=%s path=%s method=%s",
                    strict_reason,
                    path,
                    request.method,
                )
                try:
                    await maybe_notify_staff_bot_client_blocked(
                        db=self.db,
                        request=request,
                        internal_reason=strict_reason,
                        source="auth_gameplay_strict",
                    )
                except Exception:
                    logger.exception("Game action client guard (strict): staff inbox notify failed")
                return JSONResponse(status_code=403, content={"detail": _FORBIDDEN_DETAIL})
            return await call_next(request)

        return await call_next(request)
