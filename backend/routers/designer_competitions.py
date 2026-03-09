# Designer Forum competitions: admin/mod create, users submit designer topics as entries, vote (100 pts per voter), winner gets rewards.
from datetime import datetime, timezone
from typing import Optional
import uuid
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

from server import db, get_current_user, send_notification, send_notification_to_all, _is_admin, _is_moderator

VOTER_REWARD_POINTS = 100


class CompetitionCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_at: str  # ISO
    end_at: str    # ISO
    reward_money: int = 0
    reward_points: int = 0
    reward_bullets: Optional[int] = None


class CompetitionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    reward_money: Optional[int] = None
    reward_points: Optional[int] = None
    reward_bullets: Optional[int] = None


class EntryCreate(BaseModel):
    comment_id: str  # post (comment) in the competition topic


class VoteRequest(BaseModel):
    entry_id: str


def _admin_or_mod(user: dict) -> bool:
    return _is_admin(user) or _is_moderator(user)


async def create_competition(body: CompetitionCreate, current_user: dict = Depends(get_current_user)):
    """Admin or mod: create a draft competition."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    comp_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": comp_id,
        "title": (body.title or "").strip(),
        "description": (body.description or "").strip() or None,
        "start_at": body.start_at.strip(),
        "end_at": body.end_at.strip(),
        "reward_money": int(body.reward_money or 0),
        "reward_points": int(body.reward_points or 0),
        "reward_bullets": int(body.reward_bullets) if body.reward_bullets is not None else None,
        "status": "draft",
        "created_by": current_user["id"],
        "created_at": now,
        "notified_at": None,
    }
    if not doc["title"]:
        raise HTTPException(status_code=400, detail="Title is required")
    await db.designer_competitions.insert_one(doc)
    return {"id": comp_id, "message": "Competition created as draft", "competition": _strip_mongo(doc)}


async def update_competition(comp_id: str, body: CompetitionUpdate, current_user: dict = Depends(get_current_user)):
    """Admin or mod: update a draft competition."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if comp.get("status") != "draft":
        raise HTTPException(status_code=400, detail="Only draft competitions can be updated")
    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.description is not None:
        updates["description"] = body.description.strip() or None
    if body.start_at is not None:
        updates["start_at"] = body.start_at.strip()
    if body.end_at is not None:
        updates["end_at"] = body.end_at.strip()
    if body.reward_money is not None:
        updates["reward_money"] = int(body.reward_money)
    if body.reward_points is not None:
        updates["reward_points"] = int(body.reward_points)
    if body.reward_bullets is not None:
        updates["reward_bullets"] = int(body.reward_bullets) if body.reward_bullets is not None else None
    if not updates:
        return {"message": "No updates", "competition": _strip_mongo(comp)}
    await db.designer_competitions.update_one({"id": comp_id}, {"$set": updates})
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    return {"message": "Updated", "competition": _strip_mongo(comp)}


async def start_competition(comp_id: str, current_user: dict = Depends(get_current_user)):
    """Admin or mod: set competition to active, create one stickied topic for entries, notify all users."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if comp.get("status") != "draft":
        raise HTTPException(status_code=400, detail="Only draft competitions can be started")
    now = datetime.now(timezone.utc).isoformat()
    title = (comp.get("title") or "Designer competition").strip()
    topic_title = f"Designer Competition: {title}"
    topic_content = (comp.get("description") or "").strip() or "Post your picture in a reply below to enter. Then use \"Submit as my entry\" on your post."
    topic_id = str(uuid.uuid4())
    topic_doc = {
        "id": topic_id,
        "title": topic_title,
        "content": topic_content,
        "category": "designer",
        "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?",
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": False,
        "is_locked": False,
    }
    await db.forum_topics.insert_one(topic_doc)
    await db.designer_competitions.update_one(
        {"id": comp_id},
        {"$set": {"status": "active", "notified_at": now, "competition_topic_id": topic_id}}
    )
    try:
        await send_notification_to_all(
            "🎨 Designer competition started",
            f'"{title}" is now open. Post your picture in the pinned competition topic in the Designer Forum and vote for your favourite! Rewards: winner gets prizes; every voter gets 100 points.',
            "system",
            category="designer_comp",
        )
    except Exception:
        pass
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    return {"message": "Competition started; topic created and pinned; all users notified", "competition": _strip_mongo(comp)}


async def end_competition(comp_id: str, current_user: dict = Depends(get_current_user)):
    """Admin or mod: set competition to ended, compute winner, pay rewards."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if comp.get("status") == "ended":
        return {"message": "Competition already ended", "competition": _strip_mongo(comp)}
    if comp.get("status") != "active":
        raise HTTPException(status_code=400, detail="Only active competitions can be ended")
    await db.designer_competitions.update_one({"id": comp_id}, {"$set": {"status": "ended"}})
    # Aggregate votes by entry_id; get all entries with max votes (ties split pot)
    pipeline = [
        {"$match": {"competition_id": comp_id}},
        {"$group": {"_id": "$entry_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    cursor = db.designer_competition_votes.aggregate(pipeline)
    vote_counts = []
    async for doc in cursor:
        vote_counts.append({"entry_id": doc["_id"], "count": doc["count"]})
    winner_entry_ids = []
    if vote_counts:
        max_count = vote_counts[0]["count"]
        winner_entry_ids = [d["entry_id"] for d in vote_counts if d["count"] == max_count]
    n = len(winner_entry_ids)
    if n > 0:
        reward_money = int(comp.get("reward_money") or 0)
        reward_points = int(comp.get("reward_points") or 0)
        reward_bullets = int(comp.get("reward_bullets") or 0) if comp.get("reward_bullets") is not None else 0
        share_money = reward_money // n
        share_points = reward_points // n
        share_bullets = reward_bullets // n
        for entry_id in winner_entry_ids:
            entry = await db.designer_competition_entries.find_one({"id": entry_id}, {"_id": 0, "user_id": 1, "author_username": 1})
            if not entry:
                continue
            winner_id = entry["user_id"]
            inc = {}
            if share_money:
                inc["money"] = share_money
            if share_points:
                inc["points"] = share_points
            if share_bullets:
                inc["bullets"] = share_bullets
            if inc:
                await db.users.update_one({"id": winner_id}, {"$inc": inc})
            parts = []
            if share_money:
                parts.append(f"${share_money:,}")
            if share_points:
                parts.append(f"{share_points:,} points")
            if share_bullets:
                parts.append(f"{share_bullets} bullets")
            msg = "You received " + " and ".join(parts) if parts else "You won!"
            if n > 1:
                msg = f"Tied for first ({n} winners, pot split equally). " + msg
            await send_notification(
                winner_id,
                "You won the Designer competition!" if n == 1 else "You won the Designer competition (tie, split pot)!",
                msg,
                "system",
            )
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    return {"message": "Competition ended", "competition": _strip_mongo(comp), "winner_entry_ids": winner_entry_ids}


async def list_competitions(
    status: Optional[str] = Query(None, description="Filter by status: draft, active, ended"),
    current_user: dict = Depends(get_current_user),
):
    """List competitions; optional filter by status (draft, active, ended)."""
    query = {}
    if status and status in ("draft", "active", "ended"):
        query["status"] = status
    comps = await db.designer_competitions.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    out = []
    for c in comps:
        out.append({
            **_strip_mongo(c),
            "entry_count": await db.designer_competition_entries.count_documents({"competition_id": c["id"]}),
            "vote_count": await db.designer_competition_votes.count_documents({"competition_id": c["id"]}),
        })
    return {"competitions": out}


async def get_active_competition(current_user: dict = Depends(get_current_user)):
    """Return the single active competition or null for the Designer Forum UI."""
    comp = await db.designer_competitions.find_one({"status": "active"}, {"_id": 0})
    if not comp:
        return {"competition": None}
    my_vote = await db.designer_competition_votes.find_one(
        {"competition_id": comp["id"], "user_id": current_user["id"]},
        {"_id": 0, "entry_id": 1},
    )
    my_entry = await db.designer_competition_entries.find_one(
        {"competition_id": comp["id"], "user_id": current_user["id"]},
        {"_id": 0, "comment_id": 1},
    )
    my_entry_comment_id = my_entry.get("comment_id") if my_entry else None
    return {
        "competition": _strip_mongo(comp),
        "my_vote_entry_id": my_vote.get("entry_id") if my_vote else None,
        "my_entry_comment_id": my_entry_comment_id,
    }


async def add_entry(comp_id: str, body: EntryCreate, current_user: dict = Depends(get_current_user)):
    """Submit a post (comment) in the competition topic as your entry. One entry per user."""
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    comp_topic_id = comp.get("competition_topic_id")
    if not comp_topic_id:
        raise HTTPException(status_code=400, detail="This competition has no entry topic")
    if comp.get("status") != "active":
        raise HTTPException(status_code=400, detail="Competition is not active")
    comment = await db.forum_comments.find_one(
        {"id": body.comment_id},
        {"_id": 0, "topic_id": 1, "author_id": 1, "author_username": 1, "gif_url": 1, "content": 1},
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Post not found")
    if comment.get("topic_id") != comp_topic_id:
        raise HTTPException(status_code=400, detail="Post must be in the competition topic")
    if comment.get("author_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You can only submit your own post")
    existing = await db.designer_competition_entries.find_one(
        {"competition_id": comp_id, "user_id": current_user["id"]},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have an entry in this competition")
    entry_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": entry_id,
        "competition_id": comp_id,
        "comment_id": body.comment_id,
        "user_id": current_user["id"],
        "author_username": current_user.get("username") or comment.get("author_username", "?"),
        "created_at": now,
    }
    await db.designer_competition_entries.insert_one(doc)
    return {"message": "Entry submitted", "entry_id": entry_id}


async def list_entries(comp_id: str, current_user: dict = Depends(get_current_user)):
    """List entries for a competition. Entries are posts (comments) in the competition topic; show gif_url/content from comment."""
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    entries = await db.designer_competition_entries.find({"competition_id": comp_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    out = []
    for e in entries:
        gif_url = None
        title = "Entry"
        if e.get("comment_id"):
            comment = await db.forum_comments.find_one({"id": e["comment_id"]}, {"_id": 0, "gif_url": 1, "content": 1})
            if comment:
                gif_url = comment.get("gif_url")
                title = (comment.get("content") or "")[:80] or "Entry"
        elif e.get("topic_id"):
            topic = await db.forum_topics.find_one({"id": e["topic_id"]}, {"_id": 0, "title": 1, "gif_url": 1})
            if topic:
                gif_url = topic.get("gif_url")
                title = topic.get("title") or "Entry"
        vote_count = await db.designer_competition_votes.count_documents({"entry_id": e["id"]})
        out.append({
            "id": e["id"],
            "comment_id": e.get("comment_id"),
            "topic_id": e.get("topic_id"),
            "author_username": e.get("author_username", "?"),
            "title": title,
            "gif_url": gif_url,
            "vote_count": vote_count,
            "created_at": e.get("created_at"),
        })
    my_vote = await db.designer_competition_votes.find_one(
        {"competition_id": comp_id, "user_id": current_user["id"]},
        {"_id": 0, "entry_id": 1},
    )
    return {"entries": out, "my_vote_entry_id": my_vote.get("entry_id") if my_vote else None}


async def vote(comp_id: str, body: VoteRequest, current_user: dict = Depends(get_current_user)):
    """Vote for an entry. One vote per user per competition. Grants 100 points to the voter."""
    comp = await db.designer_competitions.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if comp.get("status") != "active":
        raise HTTPException(status_code=400, detail="Competition is not active for voting")
    entry = await db.designer_competition_entries.find_one({"id": body.entry_id, "competition_id": comp_id}, {"_id": 1})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    existing = await db.designer_competition_votes.find_one(
        {"competition_id": comp_id, "user_id": current_user["id"]},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="You have already voted in this competition")
    now = datetime.now(timezone.utc).isoformat()
    await db.designer_competition_votes.insert_one({
        "competition_id": comp_id,
        "user_id": current_user["id"],
        "entry_id": body.entry_id,
        "created_at": now,
    })
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": VOTER_REWARD_POINTS}})
    await send_notification(
        current_user["id"],
        "You voted!",
        f"You received {VOTER_REWARD_POINTS} points for voting in the Designer competition.",
        "system",
    )
    return {"message": "Vote recorded", "points_awarded": VOTER_REWARD_POINTS}


def _strip_mongo(doc: dict) -> dict:
    if not doc:
        return {}
    return {k: v for k, v in doc.items() if k != "_id"}


def register(router):
    router.add_api_route("/forum/designer/competitions", create_competition, methods=["POST"])
    router.add_api_route("/forum/designer/competitions", list_competitions, methods=["GET"])
    router.add_api_route("/forum/designer/competitions/active", get_active_competition, methods=["GET"])
    router.add_api_route("/forum/designer/competitions/{comp_id}", update_competition, methods=["PATCH"])
    router.add_api_route("/forum/designer/competitions/{comp_id}/start", start_competition, methods=["POST"])
    router.add_api_route("/forum/designer/competitions/{comp_id}/end", end_competition, methods=["POST"])
    router.add_api_route("/forum/designer/competitions/{comp_id}/entries", add_entry, methods=["POST"])
    router.add_api_route("/forum/designer/competitions/{comp_id}/entries", list_entries, methods=["GET"])
    router.add_api_route("/forum/designer/competitions/{comp_id}/vote", vote, methods=["POST"])
