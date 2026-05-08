# Shared JSON for staff capability flags (used by /auth/staff-flags and /admin/check).
from typing import Any, Dict

from utils.staff_portal import staff_portal_password_configured, staff_portal_session_minutes


async def build_staff_flags_payload(db, current_user: Dict[str, Any]) -> Dict[str, Any]:
    """Same fields as legacy GET /admin/check; safe for any authenticated user when called from /auth/staff-flags."""
    import server as srv

    from routers.admin import admin as admin_module

    admin_category_ids = admin_module.ADMIN_CATEGORY_IDS
    mod_visible_default = admin_module.MOD_VISIBLE_CATEGORY_IDS_DEFAULT

    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_hdo = srv._is_hdo
    _is_entertainer = srv._is_entertainer
    user_has_admin_list_email = getattr(srv, "user_has_admin_list_email", lambda _u: False)

    is_admin = _is_admin(current_user)
    is_moderator = _is_moderator(current_user)
    is_help_desk_operator = _is_hdo(current_user)
    has_admin_email = user_has_admin_list_email(current_user)
    is_entertainer = _is_entertainer(current_user)
    out: Dict[str, Any] = {
        "is_admin": is_admin,
        "is_moderator": is_moderator,
        "is_help_desk_operator": is_help_desk_operator,
        "is_entertainer": is_entertainer,
        "has_admin_email": has_admin_email,
        "staff_login_session": bool(current_user.get("_jwt_staff_issued")),
        "staff_portal_enabled": staff_portal_password_configured(),
        "staff_portal_session_minutes": staff_portal_session_minutes(),
    }
    if is_moderator:
        doc = await db.game_settings.find_one({"key": "mod_visible_category_ids"}, {"_id": 0, "value": 1})
        raw = doc.get("value") if doc else None
        if isinstance(raw, list) and raw and all(isinstance(x, str) and x in admin_category_ids for x in raw):
            merged = list(raw)
            if "admin-world-systems" not in merged:
                merged.append("admin-world-systems")
            out["mod_visible_category_ids"] = merged
        else:
            out["mod_visible_category_ids"] = list(mod_visible_default)
    return out
