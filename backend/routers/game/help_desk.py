# Help Desk: tickets (create, list, get, reply, close). Staff = admin, mod, or HDO.
# Also handles admin message permission requests.
from datetime import datetime, timezone
import uuid

from fastapi import Depends, HTTPException

from typing import Optional
from pydantic import BaseModel


class TicketCreate(BaseModel):
    subject: str
    body: str


class TicketReply(BaseModel):
    body: str


class FamilyChangeNameRequest(BaseModel):
    family_tag: str  # current tag to identify the crew (case-insensitive)
    new_name: str
    new_tag: Optional[str] = None  # optional; if provided, also change tag


class AdminMessageRequestCreate(BaseModel):
    reason: str  # why they want to message an admin


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_hdo = srv._is_hdo

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
        """Create a new help desk ticket. Any authenticated user. Only one open ticket allowed at a time."""
        # Check if user already has an open ticket
        existing_open = await db.help_desk_tickets.find_one({
            "user_id": current_user["id"],
            "status": "open"
        })
        if existing_open:
            raise HTTPException(
                status_code=400, 
                detail="You already have an open ticket. Please wait for it to be resolved before creating another."
            )
        
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
        # Reply response: do not expose author_id to client
        reply_list = [
            {"author_username": r.get("author_username"), "author_role": r.get("author_role"), "body": r.get("body"), "created_at": r.get("created_at")}
            for r in reversed(replies)
        ]
        out = {
            "id": t.get("id"),
            "user_id": t.get("user_id"),
            "username": t.get("username"),
            "subject": t.get("subject"),
            "body": t.get("body"),
            "status": t.get("status", "open"),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
            "replies": reply_list,
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

    @router.post("/help-desk/change-family-name")
    async def change_family_name(body: FamilyChangeNameRequest, current_user: dict = Depends(get_current_user)):
        """Staff (admin, mod, or HDO) change a crew's name and optionally tag. Use family tag to identify the crew."""
        if not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Only staff can change crew names")
        tag = (body.family_tag or "").strip().upper().replace(" ", "")
        if len(tag) < 2:
            raise HTTPException(status_code=400, detail="Enter the crew's current tag (2+ chars)")
        fam = await db.families.find_one({"tag": tag}, {"_id": 0, "id": 1, "name": 1, "tag": 1})
        if not fam:
            raise HTTPException(status_code=404, detail=f"Crew with tag [{tag}] not found")
        new_name = (body.new_name or "").strip()[:30]
        if len(new_name) < 2:
            raise HTTPException(status_code=400, detail="New name must be 2–30 characters")
        updates = {"name": new_name}
        if body.new_tag is not None and (body.new_tag or "").strip():
            new_tag = (body.new_tag or "").strip().upper().replace(" ", "")[:4]
            if len(new_tag) < 2:
                raise HTTPException(status_code=400, detail="New tag must be 2–4 characters")
            if await db.families.find_one({"tag": new_tag, "id": {"$ne": fam["id"]}}):
                raise HTTPException(status_code=400, detail=f"Tag [{new_tag}] is already taken")
            updates["tag"] = new_tag
        if await db.families.find_one({"name": new_name, "id": {"$ne": fam["id"]}}):
            raise HTTPException(status_code=400, detail=f"Name '{new_name}' is already taken")
        await db.families.update_one({"id": fam["id"]}, {"$set": updates})
        from routers.game.families import _invalidate_list_cache, _invalidate_my_cache
        _invalidate_list_cache()
        members = await db.family_members.find({"family_id": fam["id"]}, {"_id": 0, "user_id": 1}).to_list(100)
        for m in members:
            _invalidate_my_cache(m["user_id"])
        return {
            "message": f"Crew renamed to {new_name}" + (f" [{updates.get('tag', fam['tag'])}]" if "tag" in updates else f" [{fam['tag']}]"),
            "family_id": fam["id"],
            "name": new_name,
            "tag": updates.get("tag", fam["tag"]),
        }

    # ===== Admin Message Permission Requests =====

    @router.post("/help-desk/admin-message-request")
    async def request_admin_message_permission(body: AdminMessageRequestCreate, current_user: dict = Depends(get_current_user)):
        """Request permission to send direct messages to admins/mods. Creates a special ticket for staff to review."""
        reason = (body.reason or "").strip()[:2000]
        if len(reason) < 10:
            raise HTTPException(status_code=400, detail="Please provide a reason (at least 10 characters)")
        
        # Check if user already has an open request
        existing = await db.admin_message_requests.find_one({
            "user_id": current_user["id"],
            "status": "pending"
        })
        if existing:
            raise HTTPException(status_code=400, detail="You already have a pending request. Please wait for staff to review it.")
        
        # Check if user already has permission
        has_permission = await db.admin_message_permissions.find_one({"user_id": current_user["id"]})
        if has_permission:
            raise HTTPException(status_code=400, detail="You already have permission to message staff.")
        
        request_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": request_id,
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "reason": reason,
            "status": "pending",  # pending, approved, denied
            "created_at": now,
            "reviewed_at": None,
            "reviewed_by_id": None,
            "reviewed_by_username": None,
        }
        await db.admin_message_requests.insert_one(doc)
        return {"id": request_id, "message": "Request submitted. Staff will review it shortly."}

    @router.get("/help-desk/admin-message-requests")
    async def list_admin_message_requests(current_user: dict = Depends(get_current_user)):
        """List admin message permission requests. Staff see all pending; users see their own."""
        if _can_manage_tickets(current_user):
            # Staff sees all pending requests
            cursor = db.admin_message_requests.find(
                {"status": "pending"},
                {"_id": 0}
            ).sort("created_at", -1).limit(100)
        else:
            # Users see their own requests
            cursor = db.admin_message_requests.find(
                {"user_id": current_user["id"]},
                {"_id": 0}
            ).sort("created_at", -1).limit(20)
        requests = await cursor.to_list(100)
        return {"requests": requests}

    @router.post("/help-desk/admin-message-requests/{request_id}/approve")
    async def approve_admin_message_request(request_id: str, current_user: dict = Depends(get_current_user)):
        """Approve a user's request to message staff. Admin/mod only."""
        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Only admins and moderators can approve requests")
        
        req = await db.admin_message_requests.find_one({"id": request_id}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Request already {req['status']}")
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Update request status
        await db.admin_message_requests.update_one(
            {"id": request_id},
            {"$set": {
                "status": "approved",
                "reviewed_at": now,
                "reviewed_by_id": current_user["id"],
                "reviewed_by_username": current_user.get("username") or "?",
            }}
        )
        
        # Grant permission
        await db.admin_message_permissions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": req["user_id"],
            "username": req["username"],
            "admin_id": "all",  # can message all staff
            "approved_by_id": current_user["id"],
            "approved_by_username": current_user.get("username") or "?",
            "approved_at": now,
        })
        
        # Notify the user
        await srv.send_notification(
            req["user_id"],
            "Admin Message Permission Approved",
            f"Your request to message staff has been approved by {current_user.get('username') or 'staff'}. You can now send direct messages to admins and moderators.",
            "system",
            category="system"
        )
        
        return {"message": f"Approved. {req['username']} can now message staff."}

    @router.post("/help-desk/admin-message-requests/{request_id}/deny")
    async def deny_admin_message_request(request_id: str, current_user: dict = Depends(get_current_user)):
        """Deny a user's request to message staff. Admin/mod only."""
        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Only admins and moderators can deny requests")
        
        req = await db.admin_message_requests.find_one({"id": request_id}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Request already {req['status']}")
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Update request status
        await db.admin_message_requests.update_one(
            {"id": request_id},
            {"$set": {
                "status": "denied",
                "reviewed_at": now,
                "reviewed_by_id": current_user["id"],
                "reviewed_by_username": current_user.get("username") or "?",
            }}
        )
        
        # Notify the user
        await srv.send_notification(
            req["user_id"],
            "Admin Message Permission Denied",
            "Your request to message staff directly has been denied. Please continue using the Help Desk for support.",
            "system",
            category="system"
        )
        
        return {"message": f"Denied. {req['username']} will be notified."}

    @router.delete("/help-desk/admin-message-permissions/{user_id}")
    async def revoke_admin_message_permission(user_id: str, current_user: dict = Depends(get_current_user)):
        """Revoke a user's permission to message staff. Admin/mod only."""
        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Only admins and moderators can revoke permissions")
        
        result = await db.admin_message_permissions.delete_one({"user_id": user_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Permission not found for this user")
        
        # Notify the user
        await srv.send_notification(
            user_id,
            "Admin Message Permission Revoked",
            "Your permission to message staff directly has been revoked. Please use the Help Desk for support.",
            "system",
            category="system"
        )
        
        return {"message": "Permission revoked"}

    @router.get("/help-desk/admin-message-permissions")
    async def list_admin_message_permissions(current_user: dict = Depends(get_current_user)):
        """List all users with admin message permissions. Admin/mod only."""
        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Only admins and moderators can view this")
        
        permissions = await db.admin_message_permissions.find({}, {"_id": 0}).to_list(500)
        return {"permissions": permissions}

    @router.get("/help-desk/my-admin-message-status")
    async def get_my_admin_message_status(current_user: dict = Depends(get_current_user)):
        """Check if current user can message staff and their request status."""
        has_permission = await db.admin_message_permissions.find_one({"user_id": current_user["id"]})
        pending_request = await db.admin_message_requests.find_one({
            "user_id": current_user["id"],
            "status": "pending"
        })
        is_staff = _is_admin(current_user) or _is_moderator(current_user) or _is_hdo(current_user)
        
        return {
            "can_message_staff": is_staff or bool(has_permission),
            "is_staff": is_staff,
            "has_permission": bool(has_permission),
            "has_pending_request": bool(pending_request),
            "pending_request_id": pending_request["id"] if pending_request else None,
        }
