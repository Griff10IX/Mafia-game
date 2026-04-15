# Forum: topics, comments, views, likes
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
import re

CREW_OC_TOPIC_WINDOW_MINUTES = 10  # Can create Crew OC topic only when OC is available or within this many mins before
import uuid
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, _is_admin, _is_moderator, _is_hdo, log_activity, send_notification, ADMIN_EMAILS
from utils.text import strip_emoji
from utils.sustained_page_ratelimit import PAGE_KEY_FORUM, check_sustained_page_rl


async def _forum_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_FORUM)


def _parse_iso_datetime(s):
    """Parse ISO datetime string safely; return timezone-aware datetime or None."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


MOD_DEFAULT = "#1e3a5f"
ADMIN_DEFAULT = "#a78bfa"

# Must match EMOJI_STRIP in src/pages/Social/ForumTopic.js (composer picker).
FORUM_REACTION_EMOJIS = frozenset(
    [
        "😀",
        "😃",
        "😄",
        "😁",
        "😊",
        "🙂",
        "😉",
        "😎",
        "🤩",
        "😍",
        "😂",
        "🤣",
        "😅",
        "😢",
        "😭",
        "😤",
        "😡",
        "🤬",
        "😱",
        "😰",
        "🤔",
        "😐",
        "😑",
        "🙄",
        "😏",
        "😒",
        "🥱",
        "😴",
        "🤢",
        "🤮",
        "👍",
        "👎",
        "👋",
        "🤝",
        "🙏",
        "💪",
        "✊",
        "👊",
        "🤙",
        "✌️",
        "❤️",
        "🧡",
        "💛",
        "💚",
        "💙",
        "💜",
        "🖤",
        "💔",
        "❣️",
        "💕",
        "🔥",
        "⭐",
        "✨",
        "💥",
        "💯",
        "🎉",
        "🎊",
        "🏆",
        "👑",
        "💎",
        "💰",
        "💵",
        "💸",
        "🔫",
        "💀",
        "☠️",
        "⚔️",
        "🔪",
        "🎲",
        "🃏",
        "❓",
        "❗",
        "⚠️",
        "✅",
        "❌",
        "🚫",
        "➕",
        "➖",
        "➡️",
        "⬅️",
    ]
)


def _forum_reaction_emoji_allowed(raw: str) -> Optional[str]:
    e = (raw or "").strip()
    if not e:
        return None
    return e if e in FORUM_REACTION_EMOJIS else None


async def _forum_reaction_user_rows(user_ids: List[str]) -> dict:
    if not user_ids:
        return {}
    uq = list(dict.fromkeys(user_ids))
    users = await db.users.find({"id": {"$in": uq}}, {"_id": 0, "id": 1, "username": 1, "avatar_url": 1}).to_list(600)
    out = {}
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        av = (u.get("avatar_url") or "").strip()
        safe_av = av if (av.startswith("http://") or av.startswith("https://")) else None
        out[uid] = {
            "user_id": uid,
            "username": (u.get("username") or "").strip() or "?",
            "avatar_url": safe_av,
        }
    return out


def _summarize_reaction_docs(
    docs: list,
    current_uid: str,
    user_rows: dict,
) -> Tuple[list, Optional[str]]:
    """Build emoji_reactions rows + current user's emoji (one reaction per user)."""
    my_emoji = None
    for d in docs:
        if d.get("user_id") == current_uid:
            my_emoji = d.get("emoji")
            break
    by_emoji: dict = defaultdict(list)
    for d in sorted(docs, key=lambda x: (x.get("created_at") or "")):
        em = d.get("emoji")
        uid = d.get("user_id")
        if em and uid:
            by_emoji[em].append(uid)
    emoji_order = []
    seen_e = set()
    for d in sorted(docs, key=lambda x: (x.get("created_at") or "")):
        em = d.get("emoji")
        if em and em not in seen_e:
            seen_e.add(em)
            emoji_order.append(em)
    rows = []
    for em in emoji_order:
        uids = by_emoji[em]
        preview = []
        for uid in uids[:4]:
            preview.append(user_rows.get(uid, {"user_id": uid, "username": "Unknown", "avatar_url": None}))
        rows.append({"emoji": em, "count": len(uids), "users": preview})
    return rows, my_emoji


async def _attach_emoji_reactions(topic: dict, comments: list, current_uid: str) -> None:
    topic_id = topic.get("id")
    if not topic_id:
        return
    cids = [c["id"] for c in comments if c.get("id")]
    q_comment = []
    if cids:
        q_comment = await db.forum_comment_reactions.find(
            {"topic_id": topic_id, "comment_id": {"$in": cids}},
            {"_id": 0, "comment_id": 1, "user_id": 1, "emoji": 1, "created_at": 1},
        ).sort("created_at", 1).to_list(5000)
    q_topic = await db.forum_topic_reactions.find(
        {"topic_id": topic_id},
        {"_id": 0, "user_id": 1, "emoji": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(500)
    all_uids = list({d["user_id"] for d in q_comment + q_topic if d.get("user_id")})
    user_rows = await _forum_reaction_user_rows(all_uids)
    by_cid = defaultdict(list)
    for d in q_comment:
        cid = d.get("comment_id")
        if cid:
            by_cid[cid].append(d)
    t_summary, t_my = _summarize_reaction_docs(q_topic, current_uid, user_rows)
    topic["emoji_reactions"] = t_summary
    topic["my_emoji_reaction"] = t_my
    for c in comments:
        lst = by_cid.get(c.get("id"), [])
        summ, my = _summarize_reaction_docs(lst, current_uid, user_rows)
        c["emoji_reactions"] = summ
        c["my_emoji_reaction"] = my


class ForumReactionBody(BaseModel):
    emoji: str


async def _get_author_display_colors(author_ids) -> dict:
    """Return dict author_id -> hex color for admin/mod display. Empty dict if no ids."""
    if not author_ids:
        return {}
    author_ids = set(aid for aid in author_ids if aid)
    admin_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
    admin_color = (admin_doc.get("value") or ADMIN_DEFAULT)
    if isinstance(admin_color, str):
        admin_color = admin_color.strip()
    if not admin_color or not admin_color.startswith("#"):
        admin_color = ADMIN_DEFAULT
    mod_doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
    mod_default = (mod_doc.get("value") or MOD_DEFAULT)
    if isinstance(mod_default, str):
        mod_default = mod_default.strip()
    if not mod_default or not mod_default.startswith("#"):
        mod_default = MOD_DEFAULT
    users = await db.users.find(
        {"id": {"$in": list(author_ids)}},
        {"_id": 0, "id": 1, "email": 1, "is_moderator": 1, "mod_online_color": 1},
    ).to_list(1000)
    result = {}
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        if _is_admin(u):
            result[uid] = admin_color
        elif u.get("is_moderator"):
            raw = (u.get("mod_online_color") or "").strip()
            if raw and raw.startswith("#") and len(raw) <= 9:
                result[uid] = raw
            else:
                result[uid] = mod_default
    return result


def _pick_author_online_color(
    colors: dict,
    username_to_id: dict,
    stored_author_id,
    author_username: str,
) -> Optional[str]:
    """Staff accent for forum author links. Prefer stored author_id; if it has no staff color (stale/wrong id), fall back to id resolved from author_username."""
    if stored_author_id and colors.get(stored_author_id):
        return colors[stored_author_id]
    key = (author_username or "").strip().lower()
    if not key:
        return None
    resolved = username_to_id.get(key)
    if resolved and colors.get(resolved):
        return colors[resolved]
    return None


FORUM_CATEGORIES = ["general", "entertainer", "crew_oc", "designer", "game_ideas"]  # game_ideas = Game Ideas hub + submissions
FORUM_TOPICS_PER_PAGE = 20
FORUM_TOPICS_MAX_TOTAL = 40  # page 1 = 20, page 2 = 20; beyond that topics are deleted (mods/admins only see page 2). Topics with prune_exempt=True are never auto-deleted.
FORUM_CREW_OC_TOPICS_PER_PAGE = 10
FORUM_CREW_OC_MAX_TOTAL = 20  # crew_oc: 10 per page × 2 pages; oldest beyond this are pruned

class TopicCreate(BaseModel):
    title: str
    content: str
    category: Optional[str] = "general"
    crew_oc_family_id: Optional[str] = None  # set when creating a Crew OC ad (category becomes crew_oc)
    gif_url: Optional[str] = None  # optional GIF URL (Giphy etc.); shown with topic body
    title_color: Optional[str] = None  # hex color for title (e.g. #FFD700)


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
    title_color: Optional[str] = None  # hex color for title


async def _delete_topic_fully(topic_id: str, deleted_by_id: str = None, deleted_by_username: str = None) -> None:
    """Delete a topic and all its comments and comment likes/dislikes. Clears crew OC link if applicable."""
    from utils.deleted_messages_archive import archive_message, archive_many
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if topic and topic.get("crew_oc_family_id"):
        await db.families.update_one(
            {"id": topic["crew_oc_family_id"]},
            {"$unset": {"crew_oc_forum_topic_id": ""}},
        )
    comments = await db.forum_comments.find({"topic_id": topic_id}, {"_id": 0}).to_list(500)
    comment_ids = [c.get("id") for c in comments if c.get("id")]
    if comments:
        await archive_many(source="forum_comment", docs=comments, deleted_by_id=deleted_by_id, deleted_by_username=deleted_by_username, reason="topic_deleted")
    if comment_ids:
        await db.forum_comment_likes.delete_many({"comment_id": {"$in": comment_ids}})
        await db.forum_comment_dislikes.delete_many({"comment_id": {"$in": comment_ids}})
    await db.forum_comments.delete_many({"topic_id": topic_id})
    if topic:
        await archive_message(source="forum_topic", doc=topic, deleted_by_id=deleted_by_id, deleted_by_username=deleted_by_username)
    await db.forum_topics.delete_one({"id": topic_id})


async def _delete_all_crew_oc_topics_for_family(family_id: str) -> None:
    """Delete every crew_oc forum topic for this family (one active ad replaces prior runs / orphaned rows)."""
    if not family_id:
        return
    docs = await db.forum_topics.find(
        {"category": "crew_oc", "crew_oc_family_id": family_id},
        {"_id": 0, "id": 1},
    ).to_list(200)
    for d in docs:
        tid = d.get("id")
        if tid:
            await _delete_topic_fully(tid)


async def _prune_forum_topics_for_category(category: str) -> None:
    """Drop oldest topics in a category past the cap (sticky/important first; prune_exempt skipped)."""
    cleanup_query = (
        {"category": category}
        if category in FORUM_CATEGORIES
        else {"$or": [{"category": "general"}, {"category": {"$exists": False}}]}
    )
    max_total = FORUM_CREW_OC_MAX_TOTAL if category == "crew_oc" else FORUM_TOPICS_MAX_TOTAL
    sort = [("is_important", -1), ("is_sticky", -1), ("updated_at", -1)]
    all_in_category = await db.forum_topics.find(cleanup_query, {"_id": 0, "id": 1, "prune_exempt": 1}).sort(sort).to_list(max_total + 50)
    for t in all_in_category[max_total:]:
        if t.get("prune_exempt"):
            continue
        await _delete_topic_fully(t["id"])


async def get_topics(
    category: Optional[str] = None,
    page: int = 1,
    current_user: dict = Depends(get_current_user),
):
    """List topics: 20 per page (10 for Crew OC). Page 2 is mods/admins only. Oldest beyond cap are pruned on new posts."""
    if page not in (1, 2):
        page = 1
    if page == 2 and not _is_admin(current_user) and not _is_moderator(current_user):
        raise HTTPException(status_code=403, detail="Only moderators and admins can view page 2")
    query = {}
    if category and category in FORUM_CATEGORIES:
        if category == "general":
            # Include announcements (e.g. Update Log from update_update_log_topic.py) in the General list
            query["$or"] = [
                {"category": "general"},
                {"category": {"$exists": False}},
                {"category": "announcements"},
            ]
        else:
            query["category"] = category
    sort = [("is_important", -1), ("is_sticky", -1), ("updated_at", -1)]
    per_page = FORUM_CREW_OC_TOPICS_PER_PAGE if category == "crew_oc" else FORUM_TOPICS_PER_PAGE
    skip = (page - 1) * per_page
    topics = await db.forum_topics.find(query, {"_id": 0}).sort(sort).skip(skip).limit(per_page).to_list(per_page)
    author_ids = [t.get("author_id") for t in topics if t.get("author_id")]
    # Resolve every displayed author_username so staff colors work even when author_id is stale (wrong id, legacy import).
    username_to_id = {}
    usernames_to_resolve = list(set(
        (t.get("author_username") or "").strip()
        for t in topics
        if (t.get("author_username") or "").strip()
    ))
    if usernames_to_resolve:
        or_clauses = [{"username": re.compile("^" + re.escape(u) + "$", re.IGNORECASE)} for u in usernames_to_resolve if u]
        if or_clauses:
            resolved = await db.users.find({"$or": or_clauses}, {"_id": 0, "id": 1, "username": 1}).to_list(100)
            by_lower = {(u.get("username") or "").strip().lower(): u.get("id") for u in resolved if u.get("id")}
            for uname in usernames_to_resolve:
                key = (uname or "").strip().lower()
                uid = by_lower.get(key)
                if uid:
                    username_to_id[key] = uid
                    author_ids.append(uid)
    colors = await _get_author_display_colors(author_ids)
    topic_ids = [t["id"] for t in topics]
    count_by_topic = {}
    if topic_ids:
        pipeline = [
            {"$match": {"topic_id": {"$in": topic_ids}}},
            {"$group": {"_id": "$topic_id", "cnt": {"$sum": 1}}},
        ]
        count_rows = await db.forum_comments.aggregate(pipeline).to_list(100)
        count_by_topic = {r["_id"]: int(r.get("cnt") or 0) for r in count_rows}
    crew_oc_ids = list({t["crew_oc_family_id"] for t in topics if t.get("crew_oc_family_id")})
    crew_oc_fam_map = {}
    if crew_oc_ids:
        async for fam in db.families.find(
            {"id": {"$in": crew_oc_ids}},
            {"_id": 0, "id": 1, "name": 1, "tag": 1, "crew_oc_join_fee": 1, "emblem_preset_id": 1, "avatar_url": 1},
        ):
            if fam.get("id"):
                crew_oc_fam_map[fam["id"]] = fam
    topic_ids = [t.get("id") for t in topics if t.get("id")]
    auction_by_topic = {}
    if topic_ids:
        async for a in db.forum_designer_auctions.find(
            {"topic_id": {"$in": topic_ids}},
            {
                "_id": 0,
                "topic_id": 1,
                "status": 1,
                "currency": 1,
                "current_bid": 1,
                "starting_bid": 1,
                "end_at": 1,
                "winner_username": 1,
            },
        ):
            tid = a.get("topic_id")
            if tid:
                auction_by_topic[tid] = a
    redeem_codes_on_page = list(
        {(t.get("redeem_code") or "").strip().upper() for t in topics if (t.get("redeem_code") or "").strip()}
    )
    redeem_stats_by_code: dict = {}
    if redeem_codes_on_page:
        async for rc in db.redeem_codes.find(
            {"code": {"$in": redeem_codes_on_page}},
            {"_id": 0, "code": 1, "used_count": 1, "max_uses": 1},
        ):
            ckey = (rc.get("code") or "").strip().upper()
            max_u = rc.get("max_uses")
            if ckey and max_u is not None:
                cap = int(max_u)
                used = int(rc.get("used_count") or 0)
                redeem_stats_by_code[ckey] = {
                    "redeem_max_uses": cap,
                    "redeem_uses_remaining": max(0, cap - used),
                }
    out = []
    for t in topics:
        comment_count = count_by_topic.get(t["id"], 0)
        item = {
            "id": t["id"],
            "title": t["title"],
            "title_color": t.get("title_color"),
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
        col = _pick_author_online_color(
            colors,
            username_to_id,
            t.get("author_id"),
            t.get("author_username") or "",
        )
        if col:
            item["author_online_color"] = col
        if t.get("crew_oc_family_id"):
            item["crew_oc_family_id"] = t["crew_oc_family_id"]
            fam = crew_oc_fam_map.get(t["crew_oc_family_id"])
            if fam:
                item["crew_oc_family_name"] = fam.get("name")
                item["crew_oc_family_tag"] = fam.get("tag")
                item["crew_oc_join_fee"] = int(fam.get("crew_oc_join_fee") or 0)
                item["crew_oc_family_emblem_preset_id"] = fam.get("emblem_preset_id")
                item["crew_oc_family_emblem_avatar_url"] = fam.get("avatar_url")
        if t.get("redeem_code"):
            item["redeem_code"] = t["redeem_code"]
            rkey = (t["redeem_code"] or "").strip().upper()
            if rkey and rkey in redeem_stats_by_code:
                item.update(redeem_stats_by_code[rkey])
        if item.get("category") == "designer":
            auc = auction_by_topic.get(t.get("id"))
            if auc:
                item["designer_auction"] = {
                    "status": auc.get("status"),
                    "currency": auc.get("currency"),
                    "current_bid": int(auc.get("current_bid") or 0),
                    "starting_bid": int(auc.get("starting_bid") or 0),
                    "end_at": auc.get("end_at"),
                    "winner_username": auc.get("winner_username"),
                }
        out.append(item)
    can_view_page_2 = _is_admin(current_user) or _is_moderator(current_user)
    return {
        "topics": out,
        "categories": FORUM_CATEGORIES,
        "page": page,
        "can_view_page_2": can_view_page_2,
        "topics_per_page": per_page,
    }


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
    author_ids = [topic.get("author_id")] + [c.get("author_id") for c in comments if c.get("author_id")]
    # Resolve every displayed username so staff colors match author_username when author_id is stale.
    usernames_to_resolve = []
    if (topic.get("author_username") or "").strip():
        usernames_to_resolve.append((topic.get("author_username") or "").strip())
    for c in comments:
        if (c.get("author_username") or "").strip():
            usernames_to_resolve.append((c.get("author_username") or "").strip())
    username_to_id = {}
    unique_names = [u for u in set(usernames_to_resolve) if u]
    if unique_names:
        or_clauses = [{"username": re.compile("^" + re.escape(u) + "$", re.IGNORECASE)} for u in unique_names]
        resolved = await db.users.find({"$or": or_clauses}, {"_id": 0, "id": 1, "username": 1}).to_list(200)
        by_lower = {(u.get("username") or "").strip().lower(): u.get("id") for u in resolved if u.get("id")}
        for uname in unique_names:
            key = (uname or "").strip().lower()
            uid = by_lower.get(key)
            if uid:
                username_to_id[key] = uid
                author_ids.append(uid)
    colors = await _get_author_display_colors(author_ids)
    tcol = _pick_author_online_color(
        colors,
        username_to_id,
        topic.get("author_id"),
        topic.get("author_username") or "",
    )
    if tcol:
        topic["author_online_color"] = tcol
    for c in comments:
        ccol = _pick_author_online_color(
            colors,
            username_to_id,
            c.get("author_id"),
            c.get("author_username") or "",
        )
        if ccol:
            c["author_online_color"] = ccol
    # Attach like/dislike status for current user (batched)
    uid = current_user.get("id") or ""
    comment_ids = [c["id"] for c in comments if c.get("id")]
    liked_ids = set()
    disliked_ids = set()
    if comment_ids and uid:
        like_docs = await db.forum_comment_likes.find(
            {"comment_id": {"$in": comment_ids}, "user_id": uid},
            {"_id": 0, "comment_id": 1},
        ).to_list(500)
        liked_ids = {d["comment_id"] for d in like_docs if d.get("comment_id")}
        dislike_docs = await db.forum_comment_dislikes.find(
            {"comment_id": {"$in": comment_ids}, "user_id": uid},
            {"_id": 0, "comment_id": 1},
        ).to_list(500)
        disliked_ids = {d["comment_id"] for d in dislike_docs if d.get("comment_id")}
    for c in comments:
        cid = c.get("id")
        c["liked"] = cid in liked_ids if cid else False
        c["disliked"] = cid in disliked_ids if cid else False
    await _attach_emoji_reactions(topic, comments, uid)
    if topic.get("crew_oc_family_id"):
        fam = await db.families.find_one(
            {"id": topic["crew_oc_family_id"]},
            {
                "_id": 0,
                "name": 1,
                "tag": 1,
                "crew_oc_join_fee": 1,
                "crew_oc_cooldown_until": 1,
                "emblem_preset_id": 1,
                "avatar_url": 1,
            },
        )
        if fam:
            topic["crew_oc_family_name"] = fam.get("name")
            topic["crew_oc_family_tag"] = fam.get("tag")
            topic["crew_oc_join_fee"] = int(fam.get("crew_oc_join_fee") or 0)
            topic["crew_oc_cooldown_until"] = fam.get("crew_oc_cooldown_until")
            topic["crew_oc_family_emblem_preset_id"] = fam.get("emblem_preset_id")
            topic["crew_oc_family_emblem_avatar_url"] = fam.get("avatar_url")
        app = await db.family_crew_oc_applications.find_one(
            {"family_id": topic["crew_oc_family_id"], "user_id": current_user["id"]},
            {"_id": 0, "status": 1},
        )
        topic["crew_oc_my_application"] = {"status": app["status"]} if app else None
    if topic.get("category") == "designer":
        auc = await db.forum_designer_auctions.find_one(
            {"topic_id": topic_id},
            {
                "_id": 0,
                "id": 1,
                "status": 1,
                "currency": 1,
                "current_bid": 1,
                "starting_bid": 1,
                "end_at": 1,
                "winner_username": 1,
            },
        )
        if auc:
            topic["designer_auction"] = {
                "id": auc.get("id"),
                "status": auc.get("status"),
                "currency": auc.get("currency"),
                "current_bid": int(auc.get("current_bid") or 0),
                "starting_bid": int(auc.get("starting_bid") or 0),
                "end_at": auc.get("end_at"),
                "winner_username": auc.get("winner_username"),
            }
    if (topic.get("redeem_code") or "").strip():
        rc_code = (topic["redeem_code"] or "").strip().upper()
        rc_doc = await db.redeem_codes.find_one(
            {"code": rc_code},
            {"_id": 0, "used_count": 1, "max_uses": 1},
        )
        if rc_doc and rc_doc.get("max_uses") is not None:
            cap = int(rc_doc["max_uses"])
            used = int(rc_doc.get("used_count") or 0)
            topic["redeem_max_uses"] = cap
            topic["redeem_uses_remaining"] = max(0, cap - used)
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
        # Crew OC topic only when OC is available or within CREW_OC_TOPIC_WINDOW_MINUTES before it becomes available
        cooldown_until = _parse_iso_datetime(fam.get("crew_oc_cooldown_until"))
        if cooldown_until:
            now = datetime.now(timezone.utc)
            window_start = cooldown_until - timedelta(minutes=CREW_OC_TOPIC_WINDOW_MINUTES)
            if now < window_start:
                raise HTTPException(
                    status_code=400,
                    detail=f"You can only create a Crew OC topic when your Crew OC is available or up to {CREW_OC_TOPIC_WINDOW_MINUTES} minutes before it becomes available.",
                )
    if category not in FORUM_CATEGORIES:
        category = "general"
    if category == "game_ideas" and not _is_admin(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only admins can create Game Ideas forum topics. Use the official hub topic when a season is running.",
        )
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    gif_url = (request.gif_url or "").strip()
    if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid GIF URL")
    # Only admins/mods can use title colors
    title_color = ""
    if _is_admin(current_user) or _is_moderator(current_user):
        title_color = (request.title_color or "").strip()
        if title_color and not (title_color.startswith("#") and len(title_color) <= 9):
            title_color = ""  # Invalid color, ignore
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
    if title_color:
        doc["title_color"] = title_color
    if crew_oc_family_id:
        await _delete_all_crew_oc_topics_for_family(crew_oc_family_id)
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
    await _prune_forum_topics_for_category(category)
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
        {"_id": 0, "is_locked": 1, "title": 1, "author_id": 1, "category": 1},
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic.get("is_locked"):
        raise HTTPException(status_code=400, detail="Topic is locked")
    content = (request.content or "").strip()
    gif_url = (request.gif_url or "").strip()
    if topic.get("category") == "designer":
        content = strip_emoji(content)
        gif_url = strip_emoji(gif_url).strip()
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
            actor_username=author_username,
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
            actor_username=author_username,
        )
        notified_ids.add(reply_to_author_id)
    mention_names = list(dict.fromkeys(_extract_mention_usernames(content)))
    if mention_names:
        m_or = [{"username": re.compile("^" + re.escape(u) + "$", re.IGNORECASE)} for u in mention_names if u]
        if m_or:
            mentioned_users = await db.users.find({"$or": m_or}, {"_id": 0, "id": 1, "username": 1}).to_list(50)
            by_lower = {(u.get("username") or "").strip().lower(): u for u in mentioned_users if u.get("id")}
            for username in mention_names:
                key = (username or "").strip().lower()
                mentioned = by_lower.get(key)
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
                            actor_username=author_username,
                        )
                        notified_ids.add(uid)

    return {
        "id": comment_id,
        "message": "Comment posted",
        "comment": {
            **doc,
            "liked": False,
            "disliked": False,
            "dislikes": 0,
            "emoji_reactions": [],
            "my_emoji_reaction": None,
        },
    }


async def like_comment(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Toggle like on a comment (one like per user). Removes dislike if present."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    uid = current_user.get("id") or ""
    existing = await db.forum_comment_likes.find_one({"comment_id": comment_id, "user_id": uid})
    if existing:
        await db.forum_comment_likes.delete_one({"comment_id": comment_id, "user_id": uid})
        await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"likes": -1}})
        return {"liked": False, "likes": max(0, comment.get("likes", 0) - 1), "disliked": False, "dislikes": comment.get("dislikes", 0)}
    # Remove dislike if user is now liking
    existing_dislike = await db.forum_comment_dislikes.find_one({"comment_id": comment_id, "user_id": uid})
    dislikes = comment.get("dislikes", 0)
    if existing_dislike:
        await db.forum_comment_dislikes.delete_one({"comment_id": comment_id, "user_id": uid})
        await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"dislikes": -1}})
        dislikes = max(0, dislikes - 1)
    await db.forum_comment_likes.insert_one({"comment_id": comment_id, "user_id": uid})
    await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"likes": 1}})
    return {"liked": True, "likes": comment.get("likes", 0) + 1, "disliked": False, "dislikes": dislikes}


async def dislike_comment(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Toggle dislike on a comment (one dislike per user). Removes like if present."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    uid = current_user.get("id") or ""
    existing = await db.forum_comment_dislikes.find_one({"comment_id": comment_id, "user_id": uid})
    if existing:
        await db.forum_comment_dislikes.delete_one({"comment_id": comment_id, "user_id": uid})
        await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"dislikes": -1}})
        return {"disliked": False, "dislikes": max(0, comment.get("dislikes", 0) - 1), "liked": False, "likes": comment.get("likes", 0)}
    # Remove like if user is now disliking
    existing_like = await db.forum_comment_likes.find_one({"comment_id": comment_id, "user_id": uid})
    likes = comment.get("likes", 0)
    if existing_like:
        await db.forum_comment_likes.delete_one({"comment_id": comment_id, "user_id": uid})
        await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"likes": -1}})
        likes = max(0, likes - 1)
    await db.forum_comment_dislikes.insert_one({"comment_id": comment_id, "user_id": uid})
    await db.forum_comments.update_one({"id": comment_id}, {"$inc": {"dislikes": 1}})
    return {"disliked": True, "dislikes": comment.get("dislikes", 0) + 1, "liked": False, "likes": likes}


async def list_comment_like_users(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List users who liked this comment (alphabetical by username)."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0, "id": 1})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    docs = await db.forum_comment_likes.find({"comment_id": comment_id}, {"_id": 0, "user_id": 1}).to_list(500)
    user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    if not user_ids:
        return {"users": []}
    unique_ids = list(dict.fromkeys(user_ids))
    users = await db.users.find({"id": {"$in": unique_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(500)
    by_id = {u["id"]: (u.get("username") or "").strip() or u["id"] for u in users}
    rows = [{"user_id": uid, "username": by_id.get(uid, "Unknown")} for uid in unique_ids]
    rows.sort(key=lambda r: (r["username"] or "").lower())
    return {"users": rows}


async def list_comment_dislike_users(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List users who disliked this comment (alphabetical by username)."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0, "id": 1})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    docs = await db.forum_comment_dislikes.find({"comment_id": comment_id}, {"_id": 0, "user_id": 1}).to_list(500)
    user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    if not user_ids:
        return {"users": []}
    unique_ids = list(dict.fromkeys(user_ids))
    users = await db.users.find({"id": {"$in": unique_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(500)
    by_id = {u["id"]: (u.get("username") or "").strip() or u["id"] for u in users}
    rows = [{"user_id": uid, "username": by_id.get(uid, "Unknown")} for uid in unique_ids]
    rows.sort(key=lambda r: (r["username"] or "").lower())
    return {"users": rows}


async def _forum_reactions_require_unlocked_topic(topic_id: str) -> None:
    t = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0, "is_locked": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Topic not found")
    if t.get("is_locked"):
        raise HTTPException(status_code=400, detail="Topic is locked")


async def _comment_emoji_summary(topic_id: str, comment_id: str, current_uid: str) -> dict:
    docs = await db.forum_comment_reactions.find(
        {"topic_id": topic_id, "comment_id": comment_id},
        {"_id": 0, "user_id": 1, "emoji": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(500)
    uids = [d["user_id"] for d in docs if d.get("user_id")]
    user_rows = await _forum_reaction_user_rows(uids)
    summ, my = _summarize_reaction_docs(docs, current_uid, user_rows)
    return {"emoji_reactions": summ, "my_emoji_reaction": my}


async def _topic_emoji_summary(topic_id: str, current_uid: str) -> dict:
    docs = await db.forum_topic_reactions.find(
        {"topic_id": topic_id},
        {"_id": 0, "user_id": 1, "emoji": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(500)
    uids = [d["user_id"] for d in docs if d.get("user_id")]
    user_rows = await _forum_reaction_user_rows(uids)
    summ, my = _summarize_reaction_docs(docs, current_uid, user_rows)
    return {"emoji_reactions": summ, "my_emoji_reaction": my}


async def set_comment_emoji_reaction(
    topic_id: str,
    comment_id: str,
    body: ForumReactionBody,
    current_user: dict = Depends(get_current_user),
):
    """Set or toggle emoji reaction on a comment (one per user). Same emoji again removes yours."""
    await _forum_reactions_require_unlocked_topic(topic_id)
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0, "id": 1})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    uid = current_user.get("id") or ""
    em = _forum_reaction_emoji_allowed(body.emoji)
    if not em:
        raise HTTPException(status_code=400, detail="That emoji is not allowed for reactions.")
    existing = await db.forum_comment_reactions.find_one({"comment_id": comment_id, "user_id": uid})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        if existing.get("emoji") == em:
            await db.forum_comment_reactions.delete_one({"comment_id": comment_id, "user_id": uid})
        else:
            await db.forum_comment_reactions.update_one(
                {"comment_id": comment_id, "user_id": uid},
                {"$set": {"emoji": em, "created_at": now}},
            )
    else:
        await db.forum_comment_reactions.insert_one(
            {
                "comment_id": comment_id,
                "topic_id": topic_id,
                "user_id": uid,
                "emoji": em,
                "created_at": now,
            }
        )
    return await _comment_emoji_summary(topic_id, comment_id, uid)


async def set_topic_emoji_reaction(
    topic_id: str,
    body: ForumReactionBody,
    current_user: dict = Depends(get_current_user),
):
    """Set or toggle emoji reaction on the topic (original post). One per user."""
    await _forum_reactions_require_unlocked_topic(topic_id)
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0, "id": 1})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    uid = current_user.get("id") or ""
    em = _forum_reaction_emoji_allowed(body.emoji)
    if not em:
        raise HTTPException(status_code=400, detail="That emoji is not allowed for reactions.")
    existing = await db.forum_topic_reactions.find_one({"topic_id": topic_id, "user_id": uid})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        if existing.get("emoji") == em:
            await db.forum_topic_reactions.delete_one({"topic_id": topic_id, "user_id": uid})
        else:
            await db.forum_topic_reactions.update_one(
                {"topic_id": topic_id, "user_id": uid},
                {"$set": {"emoji": em, "created_at": now}},
            )
    else:
        await db.forum_topic_reactions.insert_one(
            {"topic_id": topic_id, "user_id": uid, "emoji": em, "created_at": now}
        )
    return await _topic_emoji_summary(topic_id, uid)


async def list_comment_emoji_reaction_users(
    topic_id: str,
    comment_id: str,
    emoji: str = Query(..., min_length=1, max_length=32),
    current_user: dict = Depends(get_current_user),
):
    """Users who reacted with this emoji on a comment."""
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0, "id": 1})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    em = _forum_reaction_emoji_allowed(emoji)
    if not em:
        raise HTTPException(status_code=400, detail="Invalid reaction.")
    docs = await db.forum_comment_reactions.find(
        {"topic_id": topic_id, "comment_id": comment_id, "emoji": em},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    if not user_ids:
        return {"users": []}
    unique_ids = list(dict.fromkeys(user_ids))
    users = await db.users.find({"id": {"$in": unique_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(500)
    by_id = {u["id"]: (u.get("username") or "").strip() or u["id"] for u in users}
    rows = [{"user_id": uid, "username": by_id.get(uid, "Unknown")} for uid in unique_ids]
    rows.sort(key=lambda r: (r["username"] or "").lower())
    return {"users": rows}


async def list_topic_emoji_reaction_users(
    topic_id: str,
    emoji: str = Query(..., min_length=1, max_length=32),
    current_user: dict = Depends(get_current_user),
):
    """Users who reacted with this emoji on the topic (original post)."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0, "id": 1})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    em = _forum_reaction_emoji_allowed(emoji)
    if not em:
        raise HTTPException(status_code=400, detail="Invalid reaction.")
    docs = await db.forum_topic_reactions.find(
        {"topic_id": topic_id, "emoji": em},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    if not user_ids:
        return {"users": []}
    unique_ids = list(dict.fromkeys(user_ids))
    users = await db.users.find({"id": {"$in": unique_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(500)
    by_id = {u["id"]: (u.get("username") or "").strip() or u["id"] for u in users}
    rows = [{"user_id": uid, "username": by_id.get(uid, "Unknown")} for uid in unique_ids]
    rows.sort(key=lambda r: (r["username"] or "").lower())
    return {"users": rows}


async def update_topic(
    topic_id: str,
    request: TopicUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin/Mod: sticky, important, locked, edit any topic. HDO: lock/unlock only. Author: edit own topic."""
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    uid = current_user.get("id") or ""
    # Redeem-code topics are system-owned; only staff may edit (not the admin who created the code).
    is_author = topic.get("author_id") == uid and not (topic.get("redeem_code") or "").strip()
    is_admin = _is_admin(current_user)
    is_mod = _is_moderator(current_user)
    is_hdo = _is_hdo(current_user)
    can_sticky_important = is_admin or is_mod
    can_lock = is_admin or is_mod or is_hdo
    can_edit_content = is_author or is_admin or is_mod
    active_auction = None
    if topic.get("category") == "designer":
        active_auction = await db.forum_designer_auctions.find_one(
            {"topic_id": topic_id, "status": {"$in": ["open", "in_escrow", "delivered", "disputed"]}},
            {"_id": 0, "id": 1},
        )
    updates = {}
    if can_sticky_important:
        if request.is_sticky is not None:
            updates["is_sticky"] = request.is_sticky
        if request.is_important is not None:
            updates["is_important"] = request.is_important
    if can_lock and request.is_locked is not None:
        updates["is_locked"] = request.is_locked
    if can_edit_content:
        if active_auction and not (is_admin or is_mod):
            if request.title is not None or request.content is not None or request.gif_url is not None:
                raise HTTPException(status_code=400, detail="Active designer auction topics can only be edited by staff")
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
    # Only admins/mods can use title colors
    if (is_admin or is_mod) and request.title_color is not None:
        title_color = (request.title_color or "").strip()
        if title_color and title_color.startswith("#") and len(title_color) <= 9:
            updates["title_color"] = title_color
        elif not title_color:
            updates["_unset_title_color"] = True  # signal to $unset title_color
    if not (is_admin or is_mod or is_hdo or is_author):
        raise HTTPException(status_code=403, detail="Not allowed to edit this topic")
    if not updates:
        return {"message": "No changes", "topic": topic}
    set_fields = {k: v for k, v in updates.items() if not k.startswith("_unset")}
    set_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_doc = {"$set": set_fields}
    unset_fields = {}
    if updates.get("_unset_gif"):
        unset_fields["gif_url"] = 1
    if updates.get("_unset_title_color"):
        unset_fields["title_color"] = 1
    if unset_fields:
        update_doc["$unset"] = unset_fields
    await db.forum_topics.update_one(
        {"id": topic_id},
        update_doc,
    )
    updated = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    return {"message": "Topic updated", "topic": updated}


async def create_redeem_code_forum_topic(
    code_normalized: str,
    reward_lines: List[str],
    max_uses: Optional[int] = None,
) -> str:
    """Insert a locked sticky general topic advertising a redeem code. No human author — system-generated.
    Caller stores returned id on redeem_codes.forum_topic_id."""
    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    lines_bb = "\n".join(f"[*]{strip_emoji(line)}" for line in reward_lines) if reward_lines else ""
    if max_uses is not None:
        try:
            cap = int(max_uses)
        except (TypeError, ValueError):
            cap = 0
        footer = (
            "[i][b]Automated topic[/b] — posted by the game when this code was created (not by a player). "
            "Redeem on Referral / Redeem; one redemption per account. "
            f"This topic is removed automatically after all {cap} uses have been claimed.[/i]"
        )
    else:
        footer = (
            "[i][b]Automated topic[/b] — posted by the game when this code was created (not by a player). "
            "Redeem on Referral / Redeem; one redemption per account. "
            "This code has no global use limit, so this topic stays until staff deactivate or delete the code.[/i]"
        )
    content = (
        f"[b]Code:[/b] [color=#FFD700]{code_normalized}[/color]\n\n[b]Rewards:[/b]\n[list]{lines_bb}\n[/list]\n\n"
        f"{footer}"
    )
    doc = {
        "id": topic_id,
        "title": strip_emoji(f"Redeem code: {code_normalized}"),
        "content": content,
        "category": "general",
        "author_id": "",
        "author_username": "",
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": False,
        "is_locked": True,
        "prune_exempt": True,
        "redeem_code": code_normalized,
    }
    await db.forum_topics.insert_one(doc)
    return topic_id


async def remove_redeem_code_forum_topic(topic_id: Optional[str]) -> None:
    """Delete forum topic created for a redeem code (no-op if falsy)."""
    if not topic_id:
        return
    await _delete_topic_fully(topic_id)


async def delete_topic(
    topic_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Admin/Mod/HDO: delete a topic and all its comments."""
    if not (_is_admin(current_user) or _is_moderator(current_user) or _is_hdo(current_user)):
        raise HTTPException(status_code=403, detail="Staff only")
    topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if topic.get("category") == "designer":
        auc = await db.forum_designer_auctions.find_one({"topic_id": topic_id}, {"_id": 0, "id": 1})
        if auc and auc.get("id"):
            await db.forum_designer_auction_bids.delete_many({"auction_id": auc["id"]})
            await db.forum_designer_auction_disputes.delete_many({"auction_id": auc["id"]})
            await db.forum_designer_auctions.delete_one({"id": auc["id"]})
    await _delete_topic_fully(topic_id, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"))
    return {"message": "Topic deleted"}


async def delete_comment(
    topic_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Admin/Mod/HDO: delete a single comment from a topic."""
    if not (_is_admin(current_user) or _is_moderator(current_user) or _is_hdo(current_user)):
        raise HTTPException(status_code=403, detail="Staff only")
    comment = await db.forum_comments.find_one({"id": comment_id, "topic_id": topic_id}, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    from utils.deleted_messages_archive import archive_message
    await archive_message(source="forum_comment", doc=comment, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"))
    await db.forum_comment_likes.delete_many({"comment_id": comment_id})
    await db.forum_comment_dislikes.delete_many({"comment_id": comment_id})
    await db.forum_comment_reactions.delete_many({"comment_id": comment_id})
    await db.forum_comments.delete_one({"id": comment_id})
    return {"message": "Comment deleted"}


def register(router):
    _forum_rl = [Depends(_forum_sustained_rl_user)]
    router.add_api_route("/forum/topics", get_topics, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics", create_topic, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}", get_topic, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments", add_comment, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/reactions/users", list_comment_emoji_reaction_users, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/reactions", set_comment_emoji_reaction, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/like", like_comment, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/dislike", dislike_comment, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/likes", list_comment_like_users, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}/dislikes", list_comment_dislike_users, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/reactions/users", list_topic_emoji_reaction_users, methods=["GET"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/reactions", set_topic_emoji_reaction, methods=["POST"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}/comments/{comment_id}", delete_comment, methods=["DELETE"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}", update_topic, methods=["PATCH"], dependencies=_forum_rl)
    router.add_api_route("/forum/topics/{topic_id}", delete_topic, methods=["DELETE"], dependencies=_forum_rl)
