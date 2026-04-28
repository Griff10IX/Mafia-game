# Help Desk: tickets (create, list, get, reply, close). Staff = admin, mod, or HDO.
# Also handles admin message permission requests.
# Staff (admin/mod/hdo) can add words to the profanity blacklist; only admin can remove.
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException, Query

from typing import Optional
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from utils.profanity import contains_profanity

HDO_POINTS_PER_CLOSE = 100


class TicketCreate(BaseModel):
    subject: str
    body: str


class TicketReply(BaseModel):
    body: str


class ErrorReportCreate(BaseModel):
    error_message: str
    stack_trace: Optional[str] = None
    page_url: Optional[str] = None


class TicketReward(BaseModel):
    amount: int


class BlacklistAdd(BaseModel):
    word: str


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

    async def _ensure_hdo_point_request_indexes():
        coll = db.help_desk_hdo_point_requests
        await coll.create_index([("status", 1), ("created_at", -1)])
        await coll.create_index([("hdo_user_id", 1), ("status", 1)])
        await coll.create_index("ticket_id", unique=True)

    def _hdo_close_context_snapshot(ticket: dict) -> dict:
        """Persist enough ticket text for admin approval if the ticket row is later purged (e.g. 48h closed prune)."""
        thread = []
        # Same order as _ticket_to_response (newest reply first, matches in-game ticket UI).
        for rep in reversed(ticket.get("replies") or []):
            body = (rep.get("body") or "").strip()
            if len(body) > 8000:
                body = body[:8000] + "…"
            thread.append(
                {
                    "author_username": rep.get("author_username") or "?",
                    "author_role": rep.get("author_role") or "?",
                    "body": body,
                    "created_at": rep.get("created_at"),
                }
            )
        ob = (ticket.get("body") or "").strip()
        if len(ob) > 12000:
            ob = ob[:12000] + "…"
        return {
            "subject": ((ticket.get("subject") or "").strip()[:500]) or "—",
            "category": ticket.get("category") or "general",
            "player_username": ticket.get("username") or "?",
            "initial_message": ob,
            "thread": thread,
        }

    def _can_manage_tickets(user: dict) -> bool:
        return _is_admin(user) or _is_moderator(user) or _is_hdo(user)

    async def _get_profanity_additions():
        cursor = db.profanity_additions.find({}, {"_id": 0, "word": 1})
        docs = await cursor.to_list(2000)
        return frozenset((d["word"] for d in docs))

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
        additions = await _get_profanity_additions()
        if contains_profanity(subject + " " + body_text, extra_words=additions):
            raise HTTPException(status_code=400, detail="Your message contains a word that is not allowed.")
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

    @router.post("/help-desk/error-report")
    async def create_error_report(body: ErrorReportCreate, current_user: dict = Depends(get_current_user)):
        """Create an error report ticket from the ErrorBoundary. Does not count against one-open-ticket limit."""
        err_msg = (body.error_message or "").strip()[:500] or "Unknown error"
        stack = (body.stack_trace or "").strip()[:5000] or ""
        page_url = (body.page_url or "").strip()[:500] or ""
        subject = f"[Bug Report] {err_msg[:100]}"
        body_parts = [f"Error: {err_msg}"]
        if page_url:
            body_parts.append(f"\nPage URL: {page_url}")
        if stack:
            body_parts.append(f"\nStack trace:\n{stack}")
        body_text = "\n".join(body_parts)[:10_000]
        ticket_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": ticket_id,
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "subject": subject,
            "body": body_text,
            "status": "open",
            "category": "error_report",
            "created_at": now,
            "updated_at": now,
            "replies": [],
            "closed_at": None,
            "closed_by_id": None,
            "rewarded": False,
            "reward_amount": None,
        }
        await db.help_desk_tickets.insert_one(doc)
        return {"id": ticket_id, "message": "Error report submitted", "ticket": _ticket_to_response(doc)}

    @router.get("/help-desk/tickets")
    async def list_tickets(
        status_filter: str | None = None,  # open, closed, or None for all
        current_user: dict = Depends(get_current_user),
    ):
        """List tickets: own tickets for users; all tickets for admin; mods/HDOs see all except error_report."""
        # Auto-expire closed tickets after 48 hours
        cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        if _is_admin(current_user):
            query = {}
        elif _can_manage_tickets(current_user):
            query = {"category": {"$ne": "error_report"}}
        else:
            query = {"user_id": current_user["id"]}
        if status_filter in ("open", "closed"):
            query["status"] = status_filter
        # Hide (and prune) closed tickets older than 48h unless the caller explicitly filters to "closed"
        if status_filter != "closed":
            # Remove stale closed tickets so they disappear automatically
            try:
                await db.help_desk_tickets.delete_many({"status": "closed", "closed_at": {"$lt": cutoff_iso}})
            except Exception:
                pass
            query = {
                **query,
                "$or": [
                    {"status": {"$ne": "closed"}},
                    {"closed_at": {"$gte": cutoff_iso}},
                ],
            }
        cursor = db.help_desk_tickets.find(query, {"_id": 0}).sort("updated_at", -1).limit(200)
        tickets = await cursor.to_list(200)
        # Ensure open tickets are always at the top
        def _ts(val: str) -> str:
            return str(val or "")
        tickets.sort(key=lambda t: (0 if (t.get("status") or "open") == "open" else 1, _ts(t.get("updated_at"))), reverse=False)
        # Within each group, newest first by updated_at
        open_t = [t for t in tickets if (t.get("status") or "open") == "open"]
        closed_t = [t for t in tickets if (t.get("status") or "open") != "open"]
        open_t.sort(key=lambda t: _ts(t.get("updated_at")), reverse=True)
        closed_t.sort(key=lambda t: _ts(t.get("updated_at")), reverse=True)
        tickets = open_t + closed_t
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
            "category": t.get("category"),
            "rewarded": t.get("rewarded", False),
            "reward_amount": t.get("reward_amount"),
        }
        return out

    @router.get("/help-desk/tickets/{ticket_id}")
    async def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
        """Get one ticket. Author or staff only. Error reports: only admin or author."""
        ticket = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        is_author = ticket["user_id"] == current_user["id"]
        if is_author:
            pass
        elif ticket.get("category") == "error_report":
            if not _is_admin(current_user):
                raise HTTPException(status_code=403, detail="Only admins can view error reports from other users")
        elif not _can_manage_tickets(current_user):
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
        additions = await _get_profanity_additions()
        if contains_profanity(reply_text, extra_words=additions):
            raise HTTPException(status_code=400, detail="Your reply contains a word that is not allowed.")
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
        if _is_hdo(current_user):
            await _ensure_hdo_point_request_indexes()
            req_id = str(uuid.uuid4())
            try:
                await db.help_desk_hdo_point_requests.insert_one(
                    {
                        "id": req_id,
                        "hdo_user_id": current_user["id"],
                        "hdo_username": current_user.get("username") or "?",
                        "ticket_id": ticket_id,
                        "ticket_owner_username": ticket.get("username"),
                        "action": "close",
                        "amount": HDO_POINTS_PER_CLOSE,
                        "status": "pending",
                        "created_at": now,
                        "closed_at": now,
                        "close_context": _hdo_close_context_snapshot(ticket),
                    }
                )
            except DuplicateKeyError:
                pass
        return {"message": "Ticket closed", "ticket": _ticket_to_response(updated)}

    @router.post("/help-desk/tickets/{ticket_id}/reward")
    async def reward_ticket(ticket_id: str, body: TicketReward, current_user: dict = Depends(get_current_user)):
        """Admin-only: reward the reporting user with cash for an error report."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (1 <= body.amount <= 1_000_000):
            raise HTTPException(status_code=400, detail="Amount must be between 1 and 1,000,000")
        ticket = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if ticket.get("category") != "error_report":
            raise HTTPException(status_code=400, detail="Only error report tickets can be rewarded")
        if ticket.get("rewarded"):
            raise HTTPException(status_code=400, detail="This report has already been rewarded")
        user_id = ticket.get("user_id")
        if not user_id:
            raise HTTPException(status_code=400, detail="Ticket has no user")
        now = datetime.now(timezone.utc).isoformat()
        reply = {
            "author_id": current_user["id"],
            "author_username": current_user.get("username") or "?",
            "author_role": "admin",
            "body": f"Admin rewarded ${body.amount:,} for this report.",
            "created_at": now,
        }
        claim = await db.help_desk_tickets.update_one(
            {"id": ticket_id, "rewarded": {"$ne": True}},
            {
                "$push": {"replies": reply},
                "$set": {
                    "updated_at": now,
                    "rewarded": True,
                    "reward_amount": body.amount,
                },
            },
        )
        if claim.modified_count == 0:
            raise HTTPException(status_code=400, detail="This report has already been rewarded")
        await db.users.update_one({"id": user_id}, {"$inc": {"money": body.amount}})
        await srv.send_notification(
            user_id,
            "Bug Report Reward",
            f"You received ${body.amount:,} for your bug report. Thank you for helping improve the game!",
            "reward",
            category="system",
        )
        updated = await db.help_desk_tickets.find_one({"id": ticket_id}, {"_id": 0})
        return {"message": f"Rewarded ${body.amount:,}", "ticket": _ticket_to_response(updated)}

    @router.get("/help-desk/check")
    async def help_desk_check(current_user: dict = Depends(get_current_user)):
        """Whether current user can manage tickets (admin, mod, or HDO). can_approve_mute = admin or mod only. is_admin for blacklist remove."""
        return {
            "can_manage": _can_manage_tickets(current_user),
            "is_hdo": _is_hdo(current_user),
            "can_approve_mute": _is_admin(current_user) or _is_moderator(current_user),
            "is_admin": _is_admin(current_user),
        }

    @router.get("/help-desk/hdo/dashboard")
    async def hdo_dashboard(current_user: dict = Depends(get_current_user)):
        """Help Desk Operator: stats for hub (points from approved closes, pending count, tickets closed, users helped)."""
        if not _is_hdo(current_user):
            raise HTTPException(status_code=403, detail="Help Desk Operator access required")
        await _ensure_hdo_point_request_indexes()
        hid = current_user["id"]
        coll = db.help_desk_hdo_point_requests
        approved_rows = await coll.aggregate(
            [
                {"$match": {"hdo_user_id": hid, "status": "approved"}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
            ]
        ).to_list(1)
        points_earned = int((approved_rows[0] or {}).get("total") or 0) if approved_rows else 0
        pending_count = await coll.count_documents({"hdo_user_id": hid, "status": "pending"})
        rejected_count = await coll.count_documents({"hdo_user_id": hid, "status": "rejected"})
        tickets_closed = await db.help_desk_tickets.count_documents({"closed_by_id": hid, "status": "closed"})
        distinct_helped = await db.help_desk_tickets.aggregate(
            [
                {"$match": {"closed_by_id": hid, "status": "closed", "user_id": {"$ne": hid}}},
                {"$group": {"_id": "$user_id"}},
                {"$count": "n"},
            ]
        ).to_list(1)
        users_helped = int(distinct_helped[0]["n"]) if distinct_helped else 0
        staff_replies = 0
        try:
            cursor = db.help_desk_tickets.find({"replies.author_id": hid}, {"_id": 0, "replies": 1})
            async for doc in cursor:
                for rep in doc.get("replies") or []:
                    if rep.get("author_id") == hid:
                        staff_replies += 1
        except Exception:
            staff_replies = 0
        return {
            "username": current_user.get("username") or "?",
            "points_per_close": HDO_POINTS_PER_CLOSE,
            "points_earned_approved": points_earned,
            "pending_reward_count": pending_count,
            "rejected_reward_count": rejected_count,
            "tickets_closed": tickets_closed,
            "users_helped": users_helped,
            "staff_replies_count": staff_replies,
        }

    # ----- Word blacklist: staff (admin/mod/hdo) can add; only admin can remove. Added words apply site-wide (profanity list). -----

    @router.get("/help-desk/blacklist")
    async def list_blacklist(current_user: dict = Depends(get_current_user)):
        """List words added to the blacklist. Staff only. can_remove = True only for admin."""
        if not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Only staff can view the blacklist")
        cursor = db.profanity_additions.find({}, {"_id": 0}).sort("added_at", -1).limit(500)
        docs = await cursor.to_list(500)
        return {
            "words": [{"word": d["word"], "added_by_username": d.get("added_by_username", "?"), "added_at": d.get("added_at")} for d in docs],
            "can_remove": _is_admin(current_user),
        }

    @router.post("/help-desk/blacklist")
    async def add_blacklist_word(body: BlacklistAdd, current_user: dict = Depends(get_current_user)):
        """Add a word to the blacklist (blocked in helpdesk and site-wide). Admin, mod, or HDO only."""
        if not _can_manage_tickets(current_user):
            raise HTTPException(status_code=403, detail="Only staff can add blacklist words")
        raw = (body.word or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="Enter a word to blacklist")
        word = raw.lower()[:100]
        existing = await db.profanity_additions.find_one({"word": word})
        if existing:
            raise HTTPException(status_code=400, detail="That word is already blacklisted")
        now = datetime.now(timezone.utc).isoformat()
        await db.profanity_additions.insert_one({
            "word": word,
            "added_by_id": current_user["id"],
            "added_by_username": current_user.get("username") or "?",
            "added_at": now,
        })
        return {"message": f"Blacklisted: {word}", "word": word}

    @router.delete("/help-desk/blacklist")
    async def remove_blacklist_word(
        word: str = Query(..., description="Word to remove from blacklist"),
        current_user: dict = Depends(get_current_user),
    ):
        """Remove a word from the blacklist. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only admins can remove blacklist words")
        w = (word or "").strip().lower()
        if not w:
            raise HTTPException(status_code=400, detail="Specify the word to remove")
        result = await db.profanity_additions.delete_one({"word": w})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Word not found in blacklist")
        return {"message": f"Removed from blacklist: {w}"}

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
