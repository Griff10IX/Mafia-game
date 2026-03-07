# Help Desk: tickets (create, list, get, reply, close). Staff = admin, mod, or HDO.
from datetime import datetime, timezone
import uuid

from fastapi import Depends, HTTPException

from pydantic import BaseModel


class TicketCreate(BaseModel):
    subject: str
    body: str


class TicketReply(BaseModel):
    body: str


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_hdo = srv._is_hdo

    def _is_hdo(user: dict) -> bool:
        return bool(user.get("is_help_desk_operator"))

    def _can_manage_tickets(user: dict) -> bool:
        return _is_admin(user) or _is_moderator(user) or _is_hdo(user)

    def _author_role(user: dict) -> str:
        if _is_admin(user):
            return "admin"
        if _is_moderator(user):
            return "mod"
        if _is_hdo(user):
            return "hdo"
        return "user"

    @router.post("/help-desk/tickets")
    async def create_ticket(body: TicketCreate, current_user: dict = Depends(get_current_user)):
        """Create a new help desk ticket. Any authenticated user."""
        subject = (body.subject or "").strip()[:200] or "No subject"
        body_text = (body.body or "").strip()[: 10_000] or "No message"
        ticket_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": ticket_id,
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "subject": subject,
            "body": body_text,
            "status": "open",
            "created_at": now,
            "updated_at": now,
            "replies": [],
            "closed_at": None,
            "closed_by_id": None,
        }
        await db.help_desk_tickets.insert_one(doc)
        return {"id": ticket_id, "message": "Ticket created", "ticket": _ticket_to_response(doc)}

    @router.get("/help-desk/tickets")
    async def list_tickets(
        status_filter: str | None = None,  # open, closed, or None for all
        current_user: dict = Depends(get_current_user),
    ):
        """List tickets: own tickets for users; all tickets for admin/mod/hdo."""
        if _can_manage_tickets(current_user):
            query = {}
        else:
            query = {"user_id": current_user["id"]}
        if status_filter in ("open", "closed"):
            query["status"] = status_filter
        cursor = db.help_desk_tickets.find(query, {"_id": 0}).sort("updated_at", -1).limit(200)
        tickets = await cursor.to_list(200)
        return {"tickets": [_ticket_to_response(t) for t in tickets]}

    def _ticket_to_response(t: dict) -> dict:
        replies = t.get("replies") or []
        out = {
            "id": t.get("id"),
            "user_id": t.get("user_id"),
            "username": t.get("username"),
            "subject": t.get("subject"),
            "body": t.get("body"),
            "status": t.get("status", "open"),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
            "replies": list(reversed(replies)),  # newest at top, oldest at bottom
            "closed_at": t.get("closed_at"),
            "closed_by_id": t.get("closed_by_id"),
        }
        return out

    @router.get("/help-desk/tickets/{ticket_id}")
    async def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
        """Get one ticket. Author or staff only."""
        ticket = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if ticket["user_id"] != current_user["id"] and not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Not allowed to view this ticket")
        return _ticket_to_response(ticket)

    @router.post("/help-desk/tickets/{ticket_id}/reply")
    async def reply_ticket(ticket_id: str, body: TicketReply, current_user: dict = Depends(get_current_user)):
        """Add a reply. Author or staff (admin/mod/hdo). Closed tickets cannot be replied to."""
        ticket = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if ticket["status"] == "closed":
            raise HTTPException(status_code=400, detail="Ticket is closed")
        is_author = ticket["user_id"] == current_user["id"]
        if not is_author and not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Not allowed to reply to this ticket")
        reply_text = (body.body or "").strip()[: 10_000] or "No message"
        now = datetime.now(timezone.utc).isoformat()
        reply = {
            "author_id": current_user["id"],
            "author_username": current_user.get("username") or "?",
            "author_role": _author_role(current_user),
            "body": reply_text,
            "created_at": now,
        }
        await db.help_desk_tickets.update_one(
            {"id": ticket_id},
            {"$push": {"replies": reply}, "$set": {"updated_at": now}},
        )
        updated = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        return {"message": "Reply added", "ticket": _ticket_to_response(updated)}

    @router.post("/help-desk/tickets/{ticket_id}/close")
    async def close_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
        """Close a ticket. Admin, mod, or HDO only."""
        if not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Only staff can close tickets")
        ticket = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if ticket["status"] == "closed":
            return {"message": "Ticket already closed", "ticket": _ticket_to_response(ticket)}
        now = datetime.now(timezone.utc).isoformat()
        await db.help_desk_tickets.update_one(
            {"id": ticket_id},
            {"$set": {"status": "closed", "updated_at": now, "closed_at": now, "closed_by_id": current_user["id"]}},
        )
        updated = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        return {"message": "Ticket closed", "ticket": _ticket_to_response(updated)}

    @router.get("/help-desk/check")
    async def help_desk_check(current_user: dict = Depends(get_current_user)):
        """Whether current user can manage tickets (admin, mod, or HDO). can_approve_mute = admin or mod only."""
        return {
            "can_manage": _can_manage_tickets(current_user),
            "is_hdo": _is_hdo(current_user),
            "can_approve_mute": _is_admin(current_user) or _is_moderator(current_user),
        }

    @router.get("/help-desk/open-count")
    async def help_desk_open_count(current_user: dict = Depends(get_current_user)):
        """Count of open tickets: for staff (admin/mod/hdo) = all open; for others = their open tickets. Used for nav badge."""
        if _can_manage_tickets(current_user):
            query = {"status": "open"}
        else:
            query = {"user_id": current_user["id"], "status": "open"}
        count = await db.help_desk_tickets.count_documents(query)
        return {"open_tickets_count": count}
