# Forum: topics, comments, views, likes
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import re

CREW_OC_TOPIC_WINDOW_MINUTES = 10  # Can create Crew OC topic only when OC is available or within this many mins before
import uuid
from fastapi import Depends, HTTPException
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, _is_admin, _is_moderator, _is_hdo, log_activity, send_notification


FORUM_CATEGORIES = ["general", "entertainer", "crew_oc", "designer"]  # crew_oc = family Crew OC ads; designer = picture designers
FORUM_TOPICS_PER_PAGE = 20
FORUM_TOPICS_MAX_TOTAL = 40  # page 1 = 20, page 2 = 20; beyond that topics are deleted (mods/admins only see page 2)

class TopicCreate(BaseModel):
    title: str
    content: str
    category: Optional[str] = "general"
    crew_oc_family_id: Optional[str] = None  # set when creating a Crew OC ad (category becomes crew_oc)
    gif_url: Optional[str] = None  # optional GIF URL (Giphy etc.); shown with topic body


class CommentCreate(BaseModel):
    content: str
    gif_url: Optional[str] = None
    reply_to_comment_id: Optional[str] = None  # when replying to another comment, notify its author


class TopicUpdate(BaseModel):
    is_sticky: Optional[bool] = None
    is_important: Optional[bool] = None
    is_locked: Optional[bool] = None
    # Author edit (only applied if current user is topic author)
    title: Optional[str] = None
    content: Optional[str] = None
    gif_url: Optional[str] = None


async def _delete_topic_fully(topic_id: str) -> None:
    """Delete a topic and all its comments and comment likes."""
    comments = await db.forum_comments.find({"topic_id": topic_id}, {"_id": 0, "id": 1}).to_list(500)
    comment_ids = [c["id"] for c in comments]
    if comment_ids:
        await db.forum_comment_likes.delete_many({"comment_id": {"$in": comment_ids}})
    await db.forum_comments.delete_many({"topic_id": topic_id})
    await db.forum_topics.delete_one({"id": topic_id})


async def get_topics(
    category: Optional[str] = None,
    page: int = 1,
    current_user: dict = Depends(get_current_user),
):
    """List topics: 20 per page. Page 1 = newest 20; page 2 = next 20 (mods/admins only). Topics beyond 40 are deleted elsewhere."""
    if page not in (1, 2):
        page = 1
    if page == 2 and not _is_admin(current_user) and not _is_moderator(current_user):
        raise HTTPException(status_code=403, detail="Only moderators and admins can view page 2")
    query = {}
    if category and category in FORUM_CATEGORIES:
        if category == "general":
            query["$or"] = [{"category": "general"}, {"category": {"$exists": False}}]
        else:
            query["category"] = category
    sort = [("is_important", -1), ("is_sticky", -1), ("updated_at", -1)]
    skip = (page - 1) * FORUM_TOPICS_PER_PAGE
    topics = await db.forum_topics.find(query, {"_id": 0}).sort(sort).skip(skip).limit(FORUM_TOPICS_PER_PAGE).to_list(FORUM_TOPICS_PER_PAGE)
    out = []
    for t in topics:
        comment_count = await db.forum_comments.count_documents({"topic_id": t["id"]})
        item = {
            "id": t["id"],
            "title": t["title"],
            "author_username": t.get("author_username", "?"),
            "category": t.get("category", "general"),
            "posts": comment_count + 1,
            "views": t.get("views", 0),
            "is_sticky": t.get("is_sticky", False),
            "is_important": t.get("is_important", False),
            "is_locked": t.get("is_locked", False),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
        }
        if t.get("crew_oc_family_id"):
            item["crew_oc_family_id"] = t["crew_oc_family_id"]
            fam = await db.families.find_one({"id": t["crew_oc_family_id"]}, {"_id": 0, "name": 1, "tag": 1, "crew_oc_join_fee": 1})
            if fam:
                item["crew_oc_family_name"] = fam.get("name")
                item["crew_oc_family_tag"] = fam.get("tag")
                item["crew_oc_join_fee"] = int(fam.get("crew_oc_join_fee") or 0)
        out.append(item)
    can_view_page_2 = _is_admin(current_user) or _is_moderator(current_user)
    return {"topics": out, "categories": FORUM_CATEGORIES, "page": page, "can_view_page_2": can_view_page_2}


async def get_topic(topic_id: str, current_user: dict = Depends(get_current_user)):
    """Get single topic with body and comments. Increment view count only (do not update updated_at — that would reorder the topic list when returning from a topic)."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await db.forum_topics.update_one(
        {"id": topic_id},
        {"$inc": {"views": 1}},
    )
    topic["views"] = topic.get("views", 0) + 1
    comments = await db.forum_comments.find({"topic_id": topic_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Attach like status for current user
    uid = current_user["id"]
    for c in comments:
        liked = await db.forum_comment_likes.find_one({"comment_id": c["id"], "user_id": uid})
        c["liked"] = liked is not None
    if topic.get("crew_oc_family_id"):
        fam = await db.families.find_one({"id": topic["crew_oc_family_id"]}, {"_id": 0, "name": 1, "tag": 1, "crew_oc_join_fee": 1, "crew_oc_cooldown_until": 1})
        if fam:
            topic["crew_oc_family_name"] = fam.get("name")
            topic["crew_oc_family_tag"] = fam.get("tag")
            topic["crew_oc_join_fee"] = int(fam.get("crew_oc_join_fee") or 0)
            topic["crew_oc_cooldown_until"] = fam.get("crew_oc_cooldown_until")
        app = await db.family_crew_oc_applications.find_one(
            {"family_id": topic["crew_oc_family_id"], "user_id": current_user["id"]},
            {"_id": 0, "status": 1},
        )
        topic["crew_oc_my_application"] = {"status": app["status"]} if app else None
    return {
        "topic": topic,
        "comments": comments,
    }


async def _is_forum_muted(user_id: str) -> bool:
    """True if user has an active or pending_review forum mute (stops them posting)."""
    now = datetime.now(timezone.utc)
    mute = await db.forum_mutes.find_one(
        {
            "user_id": user_id,
            "status": {"$in": ["active", "pending_review"]},
            "$or": [
                {"expires_at": None},
                {"expires_at": {"$exists": False}},
                {"expires_at": {"$gt": now.isoformat()}},
            ],
        },
        {"_id": 1},
    )
    return mute is not None


async def create_topic(
    request: TopicCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new forum topic. If crew_oc_family_id is set, category is forced to crew_oc and user must be boss/underboss/capo of that family."""
    if await _is_forum_muted(current_user["id"]):
        raise HTTPException(status_code=403, detail="You are muted from the forum and cannot post.")
    title = (request.title or "").strip()
    content = (request.content or "").strip()
    crew_oc_family_id = (request.crew_oc_family_id or "").strip() or None
    category = (request.category or "general").strip().lower()
    if crew_oc_family_id:
        category = "crew_oc"
        if category not in FORUM_CATEGORIES:
            FORUM_CATEGORIES.append("crew_oc")  # ensure present
        fam = await db.families.find_one({"id": crew_oc_family_id}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "crew_oc_cooldown_until": 1})
        if not fam:
            raise HTTPException(status_code=404, detail="Family not found")
        if current_user.get("family_id") != crew_oc_family_id:
            raise HTTPException(status_code=403, detail="Not in this family")
        role = (current_user.get("family_role") or "").strip().lower()
        if role not in ("boss", "underboss", "capo"):
            raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can create Crew OC ads")
        existing = await db.families.find_one({"id": crew_oc_family_id, "crew_oc_forum_topic_id": {"$exists": True, "$ne": None}}, {"_id": 0, "crew_oc_forum_topic_id": 1})
        if existing and existing.get("crew_oc_forum_topic_id"):
            raise HTTPException(status_code=400, detail="Family already has a Crew OC topic. Use that topic or remove the link from family first.")
        # Crew OC topic only when OC is available or within CREW_OC_TOPIC_WINDOW_MINUTES before it becomes available
        cooldown_until = fam.get("crew_oc_cooldown_until")
        if cooldown_until:
            try:
                until = datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                window_start = until - timedelta(minutes=CREW_OC_TOPIC_WINDOW_MINUTES)
                if now < window_start:
                    raise HTTPException(
                        status_code=400,
                        detail=f"You can only create a Crew OC topic when your Crew OC is available or up to {CREW_OC_TOPIC_WINDOW_MINUTES} minutes before it becomes available.",
                    )
            except HTTPException:
                raise
            except Exception:
                pass
    if category not in FORUM_CATEGORIES:
        category = "general"
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    gif_url = (request.gif_url or "").strip()
    if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid GIF URL")
    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": topic_id,
        "title": title,
        "content": content,
        "category": category,
        "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?",
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": False,
        "is_important": False,
        "is_locked": False,
    }
    if gif_url:
        doc["gif_url"] = gif_url
    if crew_oc_family_id:
        doc["crew_oc_family_id"] = crew_oc_family_id
    await db.forum_topics.insert_one(doc)
    if crew_oc_family_id:
        await db.families.update_one(
            {"id": crew_oc_family_id},
            {"$set": {"crew_oc_forum_topic_id": topic_id}},
        )
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "forum_topic",
        {"topic_id": topic_id, "title": title},
    )
    # Keep only FORUM_TOPICS_MAX_TOTAL topics per category; delete oldest beyond that
    cleanup_query = {"category": category} if category in FORUM_CATEGORIES else {"$or": [{"category": "general"}, {"category": {"$exists": False}}]}
    sort = [("is_important", -1), ("is_sticky", -1), ("updated_at", -1)]
    all_in_category = await db.forum_topics.find(cleanup_query, {"_id": 0, "id": 1}).sort(sort).to_list(FORUM_TOPICS_MAX_TOTAL + 50)
    for t in all_in_category[FORUM_TOPICS_MAX_TOTAL:]:
        await _delete_topic_fully(t["id"])
    return {"id": topic_id, "message": "Topic created", "topic": {**doc, "_id": 0}}


def _extract_mention_usernames(text: str) -> List[str]:
    """Extract @Username mentions from text (alphanumeric + underscore). Returns unique usernames."""
    if not text:
        return []
    seen = set()
    out = []
    for m in re.finditer(r"@([A-Za-z0-9_]+)", text):
        u = (m.group(1) or "").strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


async def add_comment(
    topic_id: str,
    request: CommentCreate,
    current_user: dict = Depends(get_current_user),
):
    """Add a comment to a topic. Fails if topic is locked."""
    if await _is_forum_muted(current_user["id"]):
        raise HTTPException(status_code=403, detail="You are muted from the forum and cannot post.")
    topic = await db.forum_topics.find_one(
        {"id": topic_id},
        {"_id": 0, "is_locked": 1, "title": 1, "author_id": 1},
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic.get("is_locked"):
        raise HTTPException(status_code=400, detail="Topic is locked")
    content = (request.content or "").strip()
    gif_url = (request.gif_url or "").strip()
    if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid GIF URL")
    if not content and not gif_url:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    comment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    author_username = current_user.get("username") or "?"
    doc = {
        "id": comment_id,
        "topic_id": topic_id,
        "author_id": current_user["id"],
        "author_username": author_username,
        "content": content or "(GIF)",
        "created_at": now,
        "likes": 0,
    }
    if gif_url:
        doc["gif_url"] = gif_url
    reply_to_comment_id = (request.reply_to_comment_id or "").strip() or None
    if reply_to_comment_id:
        doc["reply_to_comment_id"] = reply_to_comment_id
    await db.forum_comments.insert_one(doc)
    await db.forum_topics.update_one(
        {"id": topic_id},
        {"$set": {"updated_at": now}},
    )
    await log_activity(
        current_user["id"],
        author_username,
        "forum_comment",
        {"topic_id": topic_id, "topic_title": topic.get("title") if topic else None, "comment_id": comment_id, "has_gif": bool(gif_url)},
    )

    # Notifications: topic author, reply-to author, @mentions (respect prefs via category)
    topic_title = (topic.get("title") or "your topic")[:80]
    topic_author_id = topic.get("author_id")
    reply_to_author_id = None
    if reply_to_comment_id:
        reply_comment = await db.forum_comments.find_one(
            {"id": reply_to_comment_id, "topic_id": topic_id},
            {"_id": 0, "author_id": 1},
        )
        if reply_comment:
            reply_to_author_id = reply_comment.get("author_id")

    notified_ids = set()
    if topic_author_id and topic_author_id != current_user["id"]:
        await send_notification(
            topic_author_id,
            "New reply on your topic",
            f'{author_username} replied to "{topic_title}"',
            "forum_topic_reply",
            category="forum_topic_reply",
            topic_id=topic_id,
            topic_title=topic.get("title"),
        )
        notified_ids.add(topic_author_id)
    if reply_to_author_id and reply_to_author_id != current_user["id"] and reply_to_author_id not in notified_ids:
        await send_notification(
            reply_to_author_id,
            "Reply to your comment",
            f'{author_username} replied to your comment in "{topic_title}"',
            "forum_comment_reply",
            category="forum_comment_reply",
            topic_id=topic_id,
            topic_title=topic.get("title"),
            comment_id=comment_id,
        )
        notified_ids.add(reply_to_author_id)
    for username in _extract_mention_usernames(content):
        pattern = re.compile("^" + re.escape(username) + "$", re.IGNORECASE)
        mentioned = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1})
        if mentioned:
            uid = mentioned.get("id")
            if uid and uid != current_user["id"] and uid not in notified_ids:
                await send_notification(
                    uid,
                    "Mentioned in forum",
                    f'{author_username} mentioned you in "{topic_title}"',
                    "forum_mention",
                    category="forum_mention",
                    topic_id=topic_id,
                    topic_title=topic.get("title"),
                    comment_id=comment_id,
                )
                notified_ids.add(uid)

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
    """Admin/Mod: sticky, important, locked. HDO: lock/unlock only. Author: edit title, content, gif_url."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    uid = current_user["id"]
    is_author = topic.get("author_id") == uid
    is_admin = _is_admin(current_user)
    is_mod = _is_moderator(current_user)
    is_hdo = _is_hdo(current_user)
    can_sticky_important = is_admin or is_mod
    can_lock = is_admin or is_mod or is_hdo
    updates = {}
    if can_sticky_important:
        if request.is_sticky is not None:
            updates["is_sticky"] = request.is_sticky
        if request.is_important is not None:
            updates["is_important"] = request.is_important
    if can_lock and request.is_locked is not None:
        updates["is_locked"] = request.is_locked
    if is_author:
        if request.title is not None:
            title = (request.title or "").strip()
            if not title:
                raise HTTPException(status_code=400, detail="Title cannot be empty")
            updates["title"] = title
        if request.content is not None:
            updates["content"] = (request.content or "").strip()
        if request.gif_url is not None:
            gif_url = (request.gif_url or "").strip()
            if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
                raise HTTPException(status_code=400, detail="Invalid GIF URL")
            if gif_url:
                updates["gif_url"] = gif_url
            else:
                updates["_unset_gif"] = True  # signal to $unset gif_url
    if not (is_admin or is_mod or is_hdo or is_author):
        raise HTTPException(status_code=403, detail="Not allowed to edit this topic")
    if not updates:
        return {"message": "No changes", "topic": topic}
    set_fields = {k: v for k, v in updates.items() if k != "_unset_gif"}
    set_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_doc = {"$set": set_fields}
    if updates.get("_unset_gif"):
        update_doc["$unset"] = {"gif_url": 1}
    await db.forum_topics.update_one(
        {"id": topic_id},
        update_doc,
    )
    updated = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    return {"message": "Topic updated", "topic": updated}


async def delete_topic(
    topic_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: delete a topic and all its comments."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    await _delete_topic_fully(topic_id)
    return {"message": "Topic deleted"}


def register(router):
    router.add_api_route("/forum/topics", get_topics, methods=["GET"])
    router.add_api_route("/forum/topics", create_topic, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}", get_topic, methods=["GET"])
    router.add_api_route("/forum/topics/{topic_id}/comments", add_comment, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/like", like_comment, methods=["POST"])
    router.add_api_route("/forum/topics/{topic_id}", update_topic, methods=["PATCH"])
    router.add_api_route("/forum/topics/{topic_id}", delete_topic, methods=["DELETE"])
