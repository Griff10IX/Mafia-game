# System AI reports: players submit up to 3 issues/day (bot/dupe/etc). Admin-only inbox.
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from utils.game_timezone import game_today_date_str
from utils.system_ai_inbox import (
    SYSTEM_AI_AVATAR_URL,
    send_system_ai_inbox,
)

DAILY_LIMIT = 3
MAX_SUBJECT = 120
MAX_BODY = 4000
MAX_TARGET = 40

CATEGORIES = {
    "bot_check": "Bot check",
    "dupe_check": "Dupe / multi check",
    "suspicious": "Suspicious activity",
    "other": "Other",
}


class ReportCreate(BaseModel):
    category: str
    subject: str = Field(..., min_length=3, max_length=MAX_SUBJECT)
    body: str = Field(..., min_length=10, max_length=MAX_BODY)
    target_username: Optional[str] = Field(None, max_length=MAX_TARGET)


class AdminReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=MAX_BODY)


class AdminStatus(BaseModel):
    status: str  # open | investigating | closed


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(s: str, limit: int) -> str:
    return " ".join((s or "").strip().split())[:limit]


def _public_report(doc: dict, *, include_admin: bool = False) -> Dict[str, Any]:
    replies = []
    for r in doc.get("replies") or []:
        if not isinstance(r, dict):
            continue
        # Players only see System AI replies (never raw admin notes)
        if r.get("as_system_ai") or include_admin:
            replies.append(
                {
                    "id": r.get("id"),
                    "body": r.get("body"),
                    "created_at": r.get("created_at"),
                    "as_system_ai": bool(r.get("as_system_ai")),
                }
            )
    out = {
        "id": doc.get("id"),
        "category": doc.get("category"),
        "category_label": CATEGORIES.get(doc.get("category") or "", doc.get("category")),
        "subject": doc.get("subject"),
        "body": doc.get("body"),
        "target_username": doc.get("target_username"),
        "status": doc.get("status") or "open",
        "created_at": doc.get("created_at"),
        "game_day": doc.get("game_day"),
        "replies": replies,
    }
    if include_admin:
        out["user_id"] = doc.get("user_id")
        out["username"] = doc.get("username")
        out["admin_notes"] = doc.get("admin_notes") or []
        out["closed_at"] = doc.get("closed_at")
    return out


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    require_staff_issued_if_staff_capable = srv.require_staff_issued_if_staff_capable

    async def _ensure_indexes():
        coll = db.system_ai_reports
        await coll.create_index([("user_id", 1), ("game_day", 1)])
        await coll.create_index([("status", 1), ("created_at", -1)])
        await coll.create_index("id", unique=True)

    @router.get("/system-ai/meta")
    async def system_ai_meta(current_user: dict = Depends(get_current_user)):
        day = game_today_date_str()
        used = await db.system_ai_reports.count_documents(
            {"user_id": current_user["id"], "game_day": day}
        )
        return {
            "daily_limit": DAILY_LIMIT,
            "used_today": int(used),
            "remaining_today": max(0, DAILY_LIMIT - int(used)),
            "game_day": day,
            "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items()],
            "investigated_by": "system_ai_only",
            "blurb": (
                "Reports go straight to System AI. Investigations are handled by house intelligence only — "
                "not Help Desk and not human mods. You may receive a reply in your inbox from System AI."
            ),
        }

    @router.get("/system-ai/my-reports")
    async def my_reports(current_user: dict = Depends(get_current_user)):
        rows = (
            await db.system_ai_reports.find(
                {"user_id": current_user["id"]},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(40)
            .to_list(40)
        )
        return {"reports": [_public_report(r) for r in rows]}

    @router.post("/system-ai/reports")
    async def create_report(payload: ReportCreate, current_user: dict = Depends(get_current_user)):
        await _ensure_indexes()
        cat = (payload.category or "").strip().lower()
        if cat not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")
        subject = _clean_text(payload.subject, MAX_SUBJECT)
        body = (payload.body or "").strip()
        if len(subject) < 3:
            raise HTTPException(status_code=400, detail="Subject too short")
        if len(body) < 10:
            raise HTTPException(status_code=400, detail="Give more detail (at least 10 characters)")
        if len(body) > MAX_BODY:
            raise HTTPException(status_code=400, detail="Report too long")
        target = _clean_text(payload.target_username or "", MAX_TARGET) or None

        day = game_today_date_str()
        used = await db.system_ai_reports.count_documents(
            {"user_id": current_user["id"], "game_day": day}
        )
        if used >= DAILY_LIMIT:
            raise HTTPException(
                status_code=400,
                detail=f"Daily limit reached ({DAILY_LIMIT} reports per day). Try again tomorrow.",
            )

        now = _now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "category": cat,
            "subject": subject,
            "body": body[:MAX_BODY],
            "target_username": target,
            "status": "open",
            "game_day": day,
            "created_at": now,
            "replies": [],
            "admin_notes": [],
        }
        await db.system_ai_reports.insert_one(doc)

        # Confirm to player as System AI (no staff wording)
        try:
            await send_system_ai_inbox(
                current_user["id"],
                "Report received",
                (
                    f"I have your report: {subject}\n\n"
                    f"Category: {CATEGORIES[cat]}. "
                    f"I investigate alone. Do not expect Help Desk or human staff on this channel. "
                    f"If I need you, I will write back here.\n\n"
                    f"You have {max(0, DAILY_LIMIT - used - 1)} report(s) left today."
                ),
            )
        except Exception:
            pass

        return {"message": "Report filed with System AI.", "report": _public_report(doc)}

    # ----- Admin only -----

    @router.get("/admin/system-ai/reports")
    async def admin_list_reports(
        status: Optional[str] = Query(None),
        limit: int = Query(50, ge=1, le=200),
        current_user: dict = Depends(require_staff_issued_if_staff_capable),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        q: Dict[str, Any] = {}
        if status in ("open", "investigating", "closed"):
            q["status"] = status
        rows = (
            await db.system_ai_reports.find(q, {"_id": 0})
            .sort("created_at", -1)
            .limit(int(limit))
            .to_list(int(limit))
        )
        open_count = await db.system_ai_reports.count_documents({"status": "open"})
        return {
            "reports": [_public_report(r, include_admin=True) for r in rows],
            "open_count": int(open_count),
        }

    @router.get("/admin/system-ai/reports/{report_id}")
    async def admin_get_report(
        report_id: str,
        current_user: dict = Depends(require_staff_issued_if_staff_capable),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        doc = await db.system_ai_reports.find_one({"id": report_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Report not found")
        return {"report": _public_report(doc, include_admin=True)}

    @router.post("/admin/system-ai/reports/{report_id}/reply")
    async def admin_reply_as_system_ai(
        report_id: str,
        payload: AdminReply,
        current_user: dict = Depends(require_staff_issued_if_staff_capable),
    ):
        """Reply appears as System AI to the player (inbox + thread)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        body = (payload.body or "").strip()
        if len(body) < 1:
            raise HTTPException(status_code=400, detail="Empty reply")
        doc = await db.system_ai_reports.find_one({"id": report_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Report not found")
        now = _now_iso()
        reply = {
            "id": str(uuid.uuid4()),
            "body": body[:MAX_BODY],
            "created_at": now,
            "as_system_ai": True,
            "admin_id": current_user["id"],
            "admin_username": current_user.get("username"),
        }
        await db.system_ai_reports.update_one(
            {"id": report_id},
            {
                "$push": {"replies": reply},
                "$set": {"status": "investigating", "updated_at": now},
            },
        )
        try:
            await send_system_ai_inbox(
                doc["user_id"],
                f"Re: {doc.get('subject') or 'your report'}",
                body[:MAX_BODY],
            )
        except Exception:
            pass
        fresh = await db.system_ai_reports.find_one({"id": report_id}, {"_id": 0})
        return {"message": "Sent as System AI", "report": _public_report(fresh or doc, include_admin=True)}

    @router.post("/admin/system-ai/reports/{report_id}/status")
    async def admin_set_status(
        report_id: str,
        payload: AdminStatus,
        current_user: dict = Depends(require_staff_issued_if_staff_capable),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        st = (payload.status or "").strip().lower()
        if st not in ("open", "investigating", "closed"):
            raise HTTPException(status_code=400, detail="Invalid status")
        now = _now_iso()
        sets: Dict[str, Any] = {"status": st, "updated_at": now}
        if st == "closed":
            sets["closed_at"] = now
        res = await db.system_ai_reports.update_one({"id": report_id}, {"$set": sets})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Report not found")
        doc = await db.system_ai_reports.find_one({"id": report_id}, {"_id": 0})
        return {"report": _public_report(doc, include_admin=True)}
