"""Staff-only helpers for emails scrubbed when a dead account's address is reused."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


def is_tomb_email(email: Optional[str]) -> bool:
    em = (email or "").strip().lower()
    return bool(em.startswith("dead_") and em.endswith("@deleted"))


def _clean_email(email: Optional[str]) -> Optional[str]:
    em = (email or "").strip().lower()
    if not em or "@" not in em or is_tomb_email(em):
        return None
    return em


async def resolve_staff_email_context(db, user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Explain a tomb/deleted email for staff investigation.
    Uses stored email_before_freed, registration link, or post-death replacement heuristics.
    """
    uid = user.get("id")
    current = (user.get("email") or "").strip()
    tomb = is_tomb_email(current)
    ctx: Dict[str, Any] = {
        "current_email": current or None,
        "is_tomb_email": tomb,
        "email_before_freed": None,
        "email_freed_at": user.get("email_freed_at"),
        "replacement_account": None,
        "source": None,
    }

    stored = _clean_email(user.get("email_before_freed"))
    if stored:
        ctx["email_before_freed"] = stored
        ctx["source"] = "stored_on_dead_account"

    if uid:
        repl = await db.users.find_one(
            {"registration_freed_email_from_user_id": uid},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1},
        )
        if repl:
            repl_email = _clean_email(repl.get("email"))
            ctx["replacement_account"] = {
                "id": repl.get("id"),
                "username": repl.get("username"),
                "email": repl_email,
                "created_at": repl.get("created_at"),
            }
            if repl_email and not ctx["email_before_freed"]:
                ctx["email_before_freed"] = repl_email
                ctx["source"] = "linked_replacement_registration"

    if not ctx["email_before_freed"] and tomb and uid:
        dead_at = user.get("dead_at")
        rip = (user.get("registration_ip") or "").strip()
        if rip and dead_at:
            repl = await db.users.find_one(
                {
                    "registration_ip": rip,
                    "is_dead": {"$ne": True},
                    "id": {"$ne": uid},
                    "created_at": {"$gte": dead_at},
                },
                {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1},
                sort=[("created_at", 1)],
            )
            if repl:
                repl_email = _clean_email(repl.get("email"))
                if repl_email:
                    ctx["email_before_freed"] = repl_email
                    ctx["source"] = "inferred_from_post_death_replacement"
                    ctx["replacement_account"] = {
                        "id": repl.get("id"),
                        "username": repl.get("username"),
                        "email": repl_email,
                        "created_at": repl.get("created_at"),
                    }

    return ctx


async def record_email_freed_from_dead_account(
    db,
    dead_user_id: str,
    freed_email: str,
    *,
    replacement_user_id: Optional[str] = None,
) -> None:
    """Persist original email on a dead account when a new signup reuses the address."""
    email_clean = _clean_email(freed_email)
    if not email_clean:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": dead_user_id},
        {
            "$set": {
                "email": f"dead_{dead_user_id}@deleted",
                "email_before_freed": email_clean,
                "email_freed_at": now_iso,
            }
        },
    )
