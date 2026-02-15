# Forum: topics, comments, views, likes
from datetime import datetime, timezone
from typing import List, Optional
import uuid
from fastapi import Depends, HTTPException
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, ADMIN_EMAILS


class TopicCreate(BaseModel):
    title: str
    content: str


class CommentCreate(BaseModel):
    content: str


class TopicUpdate(BaseModel):
    is_sticky: Optional[bool] = None
    is_important: Optional[bool] = None
    is_locked: Optional[bool] = None


async def get_topics(current_user: dict = Depends(get_current_user)):
    """List all topics: sticky/important first, then by updated_at. Include author, posts count, views."""
    topics = await db.forum_topics.find({}, {"_id": 0}).sort([("is_important", -1), ("is_sticky", -1), ("updated_at", -1)]).to_list(500)
    out = []
    for t in topics:
        comment_count = await db.forum_comments.count_documents({"topic_id": t["id"]})
        out.append({
            "id": t["id"],
            "title": t["title"],
            "author_username": t.get("author_username", "?"),
            "posts": comment_count + 1,  # +1 for the topic itself as first "post"
            "views": t.get("views", 0),
            "is_sticky": t.get("is_sticky", False),
            "is_important": t.get("is_important", False),
            "is_locked": t.get("is_locked", False),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
        })
    return {"topics": out}


async def get_topic(topic_id: str, current_user: dict = Depends(get_current_user)):
    """Get single topic with body and comments. Increment view count."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await db.forum_topics.update_one(
        {"id": topic_id},
        {"$inc": {"views": 1}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    topic["views"] = topic.get("views", 0) + 1
    comments = await db.forum_comments.find({"topic_id": topic_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    # Attach like status for current user
    uid = current_user["id"]
    for c in comments:
        liked = await db.forum_comment_likes.find_one({"comment_id": c["id"], "user_id": uid})
        c["liked"] = liked is not None
    return {
        "topic": topic,
        "comments": comments,
    }


async def create_topic(
    request: TopicCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new forum topic."""
    title = (request.title or "").strip()
    content = (request.content or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": topic_id,
        "title": title,
        "content": content,
        "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?",
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": False,
        "is_important": False,
        "is_locked": False,
    }
    await db.forum_topics.insert_one(doc)
    return {"id": topic_id, "message": "Topic created", "topic": {**doc, "_id": 0}}


async def add_comment(
    topic_id: str,
    request: CommentCreate,
    current_user: dict = Depends(get_current_user),
):
    """Add a comment to a topic. Fails if topic is locked."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0, "is_locked": 1})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic.get("is_locked"):
        raise HTTPException(status_code=400, detail="Topic is locked")
    content = (request.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    comment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": comment_id,
        "topic_id": topic_id,
        "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?",
        "content": content,
        "created_at": now,
        "likes": 0,
    }
    await db.forum_comments.insert_one(doc)
    await db.forum_topics.update_one(
        {"id": topic_id},
        {"$set": {"updated_at": now}},
    )
    return {"id": comment_id, "message": "Comment posted", "comment": {**doc, "liked": False}}


async def like_comment(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Toggle like on a comment (one like per user)."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    uid = current_user["id"]
    existing = await db.forum_comment_likes.find_one({"comment_id": comment_id, "user_id": uid})
    if existing:
        await db.forum_comment_likes.delete_one({"comment_id": comment_id, "user_id": uid})
        await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"likes": -1}})
        return {"liked": False, "likes": max(0, comment.get("likes", 0) - 1)}
    await db.forum_comment_likes.insert_one({"comment_id": comment_id, "user_id": uid})
    await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"likes": 1}})
    return {"liked": True, "likes": comment.get("likes", 0) + 1}


async def update_topic(
    topic_id: str,
    request: TopicUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: set sticky, important, or locked on a topic."""
    if current_user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin only")
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    updates = {}
    if request.is_sticky is not None:
        updates["is_sticky"] = request.is_sticky
    if request.is_important is not None:
        updates["is_important"] = request.is_important
    if request.is_locked is not None:
        updates["is_locked"] = request.is_locked
    if not updates:
        return {"message": "No changes", "topic": topic}
    await db.forum_topics.update_one(
        {"id": topic_id},
        {"$set": updates},
    )
    updated = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    return {"message": "Topic updated", "topic": updated}


def register(router):
    router.add_api_route("/forum/topics", get_topics, methods=["GET"])
    router.add_api_route("/forum/topics", create_topic, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}", get_topic, methods=["GET"])
    router.add_api_route("/forum/topics/{topic_id}/comments", add_comment, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/like", like_comment, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}", update_topic, methods=["PATCH"])
