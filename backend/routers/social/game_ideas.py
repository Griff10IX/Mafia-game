# Game Ideas: sticky hub topic, forum comments as submissions, primary/final voting, admin-configured rewards.
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException
from pydantic import BaseModel, field_validator

from server import db, get_current_user, _is_admin, send_notification, send_notification_to_all
from utils.text import strip_emoji


async def _is_forum_muted(user_id: str) -> bool:
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


def _strip_mongo(doc: dict) -> dict:
    out = dict(doc)
    out.pop("_id", None)
    return out


class GameIdeaSeasonCreate(BaseModel):
    title: str
    description: Optional[str] = None
    finalist_count: int = 5
    finalist_reward_money: int = 0
    finalist_reward_points: int = 0
    winner_reward_money: int = 0
    winner_reward_points: int = 0


class GameIdeaEntryCreate(BaseModel):
    comment_id: str

    @field_validator("comment_id", mode="before")
    @classmethod
    def normalize_comment_id(cls, v):
        return str(v or "").strip()


class GameIdeaVoteBody(BaseModel):
    entry_id: str

    @field_validator("entry_id", mode="before")
    @classmethod
    def normalize_entry_id(cls, v):
        return str(v or "").strip()


class ConfirmImplementationBody(BaseModel):
    entry_id: str

    @field_validator("entry_id", mode="before")
    @classmethod
    def normalize_entry_id(cls, v):
        return str(v or "").strip()


async def _primary_vote_counts(season_id: str) -> Dict[str, int]:
    pipeline = [
        {"$match": {"season_id": season_id, "phase": "primary"}},
        {"$group": {"_id": "$entry_id", "c": {"$sum": 1}}},
    ]
    out: Dict[str, int] = {}
    async for row in db.game_idea_votes.aggregate(pipeline):
        out[row["_id"]] = int(row.get("c") or 0)
    return out


async def _final_vote_counts(season_id: str) -> Dict[str, int]:
    pipeline = [
        {"$match": {"season_id": season_id, "phase": "final"}},
        {"$group": {"_id": "$entry_id", "c": {"$sum": 1}}},
    ]
    out: Dict[str, int] = {}
    async for row in db.game_idea_votes.aggregate(pipeline):
        out[row["_id"]] = int(row.get("c") or 0)
    return out


def register(router):
    @router.post("/admin/game-ideas/seasons")
    async def admin_create_game_idea_season(body: GameIdeaSeasonCreate, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        title = strip_emoji((body.title or "").strip())
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        fc = max(1, min(50, int(body.finalist_count or 5)))
        sid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": sid,
            "title": title,
            "description": (strip_emoji((body.description or "").strip()) or None),
            "status": "draft",
            "hub_topic_id": None,
            "finalist_count": fc,
            "finalist_reward_money": max(0, int(body.finalist_reward_money or 0)),
            "finalist_reward_points": max(0, int(body.finalist_reward_points or 0)),
            "winner_reward_money": max(0, int(body.winner_reward_money or 0)),
            "winner_reward_points": max(0, int(body.winner_reward_points or 0)),
            "final_winner_entry_ids": [],
            "created_by": current_user["id"],
            "created_at": now,
            "updated_at": now,
        }
        await db.game_idea_seasons.insert_one(doc)
        return {"message": "Season created (draft)", "season": _strip_mongo(doc)}

    @router.get("/admin/game-ideas/seasons")
    async def admin_list_game_idea_seasons(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        rows = await db.game_idea_seasons.find({}, {"_id": 0}).sort("created_at", -1).to_list(80)
        return {"seasons": [_strip_mongo(s) for s in rows]}

    @router.post("/admin/game-ideas/seasons/{season_id}/start")
    async def admin_start_game_idea_season(season_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "draft":
            raise HTTPException(status_code=400, detail="Only draft seasons can be started")
        active = await db.game_idea_seasons.find_one({"status": {"$in": ["primary", "final"]}}, {"_id": 0, "id": 1})
        if active:
            raise HTTPException(status_code=400, detail="Another season is already active; close it first")
        title = strip_emoji((season.get("title") or "Game Ideas").strip())
        desc = (season.get("description") or "").strip() or "Post your idea as a reply below. Then use **Register as my idea** on your post to enter the vote."
        topic_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        topic_doc = {
            "id": topic_id,
            "title": f"Game Ideas: {title}",
            "content": desc,
            "category": "game_ideas",
            "author_id": current_user["id"],
            "author_username": current_user.get("username") or "?",
            "created_at": now,
            "updated_at": now,
            "views": 0,
            "is_sticky": True,
            "is_important": True,
            "is_locked": False,
            "prune_exempt": True,
            "game_idea_season_id": season_id,
        }
        await db.forum_topics.insert_one(topic_doc)
        await db.game_idea_seasons.update_one(
            {"id": season_id},
            {"$set": {"status": "primary", "hub_topic_id": topic_id, "updated_at": now}},
        )
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        return {"message": "Season started; hub topic created", "season": _strip_mongo(season), "hub_topic_id": topic_id}

    @router.post("/admin/game-ideas/seasons/{season_id}/advance-final")
    async def admin_advance_game_idea_final(season_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "primary":
            raise HTTPException(status_code=400, detail="Season must be in primary voting")
        entries = await db.game_idea_entries.find({"season_id": season_id}, {"_id": 0}).to_list(500)
        if not entries:
            raise HTTPException(status_code=400, detail="No entries in this season")
        counts = await _primary_vote_counts(season_id)
        n = int(season.get("finalist_count") or 5)
        ranked = sorted(
            entries,
            key=lambda e: (-counts.get(e["id"], 0), str(e.get("created_at") or "")),
        )
        finalist_ids = [e["id"] for e in ranked[:n]]
        fm = max(0, int(season.get("finalist_reward_money") or 0))
        fp = max(0, int(season.get("finalist_reward_points") or 0))
        now = datetime.now(timezone.utc).isoformat()
        season_title = strip_emoji((season.get("title") or "Game Ideas").strip())
        for e in entries:
            eid = e["id"]
            is_f = eid in finalist_ids
            await db.game_idea_entries.update_one({"id": eid}, {"$set": {"is_finalist": is_f}})
            if is_f and not e.get("finalist_reward_paid_at"):
                uid = e.get("user_id")
                if uid and (fm > 0 or fp > 0):
                    inc: Dict[str, int] = {}
                    if fm:
                        inc["money"] = fm
                    if fp:
                        inc["points"] = fp
                    await db.users.update_one({"id": uid}, {"$inc": inc})
                if uid:
                    parts = []
                    if fm:
                        parts.append(f"${fm:,}")
                    if fp:
                        parts.append(f"{fp:,} points")
                    reward_bit = (" You also received " + " and ".join(parts) + ".") if parts else ""
                    await send_notification(
                        uid,
                        f'Game Ideas — you\'re in the final ("{season_title}")',
                        "Primary voting ended and your idea advanced. Vote for finalists on the Game Ideas board."
                        + reward_bit,
                        "system",
                        category="game_ideas",
                    )
                await db.game_idea_entries.update_one(
                    {"id": eid},
                    {"$set": {"finalist_reward_paid_at": now}},
                )
            elif not is_f and e.get("user_id"):
                await send_notification(
                    e["user_id"],
                    f'Game Ideas — "{season_title}"',
                    "Primary voting ended. Thanks for entering — your idea did not advance to the final this time.",
                    "system",
                    category="game_ideas",
                )
        try:
            await send_notification_to_all(
                f'Game Ideas: "{season_title}" — final vote open',
                "The shortlist is set. Open the Game Ideas voting board to vote in the final round.",
                "system",
                category="game_ideas",
            )
        except Exception:
            pass
        await db.game_idea_seasons.update_one(
            {"id": season_id},
            {"$set": {"status": "final", "updated_at": now}},
        )
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        return {"message": "Finalists selected and finalist rewards paid", "finalist_entry_ids": finalist_ids, "season": _strip_mongo(season)}

    @router.post("/admin/game-ideas/seasons/{season_id}/close-final")
    async def admin_close_game_idea_final(season_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "final":
            raise HTTPException(status_code=400, detail="Season must be in final voting")
        counts = await _final_vote_counts(season_id)
        finalists = await db.game_idea_entries.find(
            {"season_id": season_id, "is_finalist": True},
            {"_id": 0, "id": 1},
        ).to_list(200)
        fids = [f["id"] for f in finalists]
        if not fids:
            raise HTTPException(status_code=400, detail="No finalists")
        sub = {k: counts.get(k, 0) for k in fids}
        max_v = max(sub.values()) if sub else 0
        winner_ids = [eid for eid, c in sub.items() if c == max_v and max_v > 0]
        if not winner_ids:
            winner_ids = fids[:1]
        now = datetime.now(timezone.utc).isoformat()
        await db.game_idea_seasons.update_one(
            {"id": season_id},
            {"$set": {"status": "closed", "final_winner_entry_ids": winner_ids, "updated_at": now}},
        )
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        return {"message": "Final vote closed", "winner_entry_ids": winner_ids, "season": _strip_mongo(season)}

    @router.post("/admin/game-ideas/seasons/{season_id}/confirm-implementation")
    async def admin_confirm_game_idea_implementation(
        season_id: str,
        body: ConfirmImplementationBody,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "closed":
            raise HTTPException(status_code=400, detail="Season must be closed before confirming implementation")
        eid = body.entry_id.strip()
        winners = list(season.get("final_winner_entry_ids") or [])
        if eid not in winners:
            raise HTTPException(status_code=400, detail="Entry is not in the final winner set for this season")
        entry = await db.game_idea_entries.find_one({"id": eid, "season_id": season_id}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        if entry.get("implementation_reward_paid_at"):
            raise HTTPException(status_code=400, detail="Implementation reward already paid for this entry")
        wm = max(0, int(season.get("winner_reward_money") or 0))
        wp = max(0, int(season.get("winner_reward_points") or 0))
        if wm == 0 and wp == 0:
            raise HTTPException(status_code=400, detail="Season has no winner reward configured")
        uid = entry.get("user_id")
        if not uid:
            raise HTTPException(status_code=400, detail="Entry has no user")
        now = datetime.now(timezone.utc).isoformat()
        inc: Dict[str, int] = {}
        if wm:
            inc["money"] = wm
        if wp:
            inc["points"] = wp
        await db.users.update_one({"id": uid}, {"$inc": inc})
        await db.game_idea_entries.update_one({"id": eid}, {"$set": {"implementation_reward_paid_at": now}})
        parts = []
        if wm:
            parts.append(f"${wm:,}")
        if wp:
            parts.append(f"{wp:,} points")
        await send_notification(
            uid,
            "Game Ideas — implementation reward",
            "Thanks for the winning idea! You received " + " and ".join(parts) + ".",
            "system",
            category="game_ideas",
        )
        return {"message": "Implementation reward granted", "entry_id": eid}

    @router.get("/admin/game-ideas/seasons/{season_id}/implementation-options")
    async def admin_game_idea_implementation_options(season_id: str, current_user: dict = Depends(get_current_user)):
        """Closed seasons only: winner entries with preview for admin dropdown (confirm implementation)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "closed":
            raise HTTPException(status_code=400, detail="Season must be closed")
        winners = list(season.get("final_winner_entry_ids") or [])
        if not winners:
            return {"season_id": season_id, "season_title": season.get("title"), "candidates": []}
        entries = await db.game_idea_entries.find({"id": {"$in": winners}}, {"_id": 0}).to_list(50)
        comment_ids = [e.get("comment_id") for e in entries if e.get("comment_id")]
        comments_map: Dict[str, Any] = {}
        if comment_ids:
            async for c in db.forum_comments.find({"id": {"$in": comment_ids}}, {"_id": 0}):
                comments_map[c["id"]] = c
        candidates: List[dict] = []
        for e in entries:
            cid = e.get("comment_id")
            preview = ""
            if cid and cid in comments_map:
                preview = strip_emoji((comments_map[cid].get("content") or "")[:120])
            candidates.append(
                {
                    "entry_id": e["id"],
                    "author_username": e.get("author_username", "?"),
                    "preview": (preview.strip() or "(no text preview)"),
                    "implementation_paid": bool(e.get("implementation_reward_paid_at")),
                }
            )
        candidates.sort(key=lambda x: (x["implementation_paid"], x["author_username"] or ""))
        return {
            "season_id": season_id,
            "season_title": season.get("title"),
            "candidates": candidates,
        }

    @router.get("/forum/game-ideas/active-season")
    async def game_ideas_active_season(current_user: dict = Depends(get_current_user)):
        season = await db.game_idea_seasons.find_one(
            {"status": {"$in": ["primary", "final"]}},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        if not season:
            season = await db.game_idea_seasons.find_one(
                {"status": "closed"},
                {"_id": 0},
                sort=[("created_at", -1)],
            )
        if not season:
            return {"season": None}
        uid = current_user.get("id")
        my_entry = await db.game_idea_entries.find_one({"season_id": season["id"], "user_id": uid}, {"_id": 0, "comment_id": 1, "id": 1})
        phase = "primary" if season.get("status") == "primary" else "final" if season.get("status") == "final" else None
        my_vote = None
        if phase and uid:
            v = await db.game_idea_votes.find_one(
                {"season_id": season["id"], "user_id": uid, "phase": phase},
                {"_id": 0, "entry_id": 1},
            )
            my_vote = v.get("entry_id") if v else None
        out = _strip_mongo(season)
        out["hub_topic_id"] = season.get("hub_topic_id")
        return {
            "season": out,
            "my_entry_comment_id": (my_entry or {}).get("comment_id"),
            "my_entry_id": (my_entry or {}).get("id"),
            "my_vote_entry_id": my_vote,
            "vote_phase": phase,
        }

    @router.get("/forum/game-ideas/seasons/{season_id}/entries")
    async def game_ideas_list_entries(season_id: str, current_user: dict = Depends(get_current_user)):
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        status = season.get("status")
        entries = await db.game_idea_entries.find({"season_id": season_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
        if status in ("final", "closed"):
            entries = [e for e in entries if e.get("is_finalist")]
        phase = "primary" if status == "primary" else "final" if status == "final" else "final" if status == "closed" else "primary"
        counts = await _primary_vote_counts(season_id) if phase == "primary" else await _final_vote_counts(season_id)
        comment_ids = [e["comment_id"] for e in entries if e.get("comment_id")]
        comments_map: Dict[str, Any] = {}
        if comment_ids:
            async for c in db.forum_comments.find({"id": {"$in": comment_ids}}, {"_id": 0}):
                comments_map[c["id"]] = c
        out: List[dict] = []
        for e in entries:
            cid = e.get("comment_id")
            com = comments_map.get(cid) if cid else None
            preview = ""
            if com:
                preview = strip_emoji((com.get("content") or "")[:200])
            out.append({
                "id": e["id"],
                "comment_id": cid,
                "author_username": e.get("author_username", "?"),
                "vote_count": counts.get(e["id"], 0),
                "preview": preview,
                "is_finalist": bool(e.get("is_finalist")),
                "user_id": e.get("user_id"),
            })
        my_vote = None
        uid = current_user.get("id")
        if uid and status in ("primary", "final"):
            v = await db.game_idea_votes.find_one(
                {"season_id": season_id, "user_id": uid, "phase": phase},
                {"_id": 0, "entry_id": 1},
            )
            my_vote = v.get("entry_id") if v else None
        return {"entries": out, "season_status": status, "vote_phase": phase, "my_vote_entry_id": my_vote}

    @router.post("/forum/game-ideas/seasons/{season_id}/entries")
    async def game_ideas_add_entry(season_id: str, body: GameIdeaEntryCreate, current_user: dict = Depends(get_current_user)):
        if await _is_forum_muted(current_user["id"]):
            raise HTTPException(status_code=403, detail="You are muted from the forum and cannot enter.")
        if current_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="Dead players cannot enter")
        if not body.comment_id:
            raise HTTPException(status_code=400, detail="comment_id is required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        if season.get("status") != "primary":
            raise HTTPException(status_code=400, detail="Entries are only open during primary voting")
        hub = season.get("hub_topic_id")
        if not hub:
            raise HTTPException(status_code=400, detail="Season has no hub topic")
        comment = await db.forum_comments.find_one(
            {"id": body.comment_id},
            {"_id": 0, "topic_id": 1, "author_id": 1, "author_username": 1},
        )
        if not comment:
            raise HTTPException(status_code=404, detail="Post not found")
        if comment.get("topic_id") != hub:
            raise HTTPException(status_code=400, detail="Post must be in the Game Ideas hub topic")
        if comment.get("author_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You can only register your own post")
        existing = await db.game_idea_entries.find_one(
            {"season_id": season_id, "user_id": current_user["id"]},
            {"_id": 1},
        )
        if existing:
            raise HTTPException(status_code=400, detail="You already entered this season")
        eid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": eid,
            "season_id": season_id,
            "user_id": current_user["id"],
            "author_username": current_user.get("username") or comment.get("author_username") or "?",
            "comment_id": body.comment_id,
            "created_at": now,
            "is_finalist": False,
        }
        await db.game_idea_entries.insert_one(doc)
        return {"message": "Idea registered", "entry_id": eid}

    @router.post("/forum/game-ideas/seasons/{season_id}/vote")
    async def game_ideas_vote(season_id: str, body: GameIdeaVoteBody, current_user: dict = Depends(get_current_user)):
        if await _is_forum_muted(current_user["id"]):
            raise HTTPException(status_code=403, detail="You are muted from the forum and cannot vote.")
        if current_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="Dead players cannot vote")
        if not body.entry_id:
            raise HTTPException(status_code=400, detail="entry_id is required")
        season = await db.game_idea_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season:
            raise HTTPException(status_code=404, detail="Season not found")
        st = season.get("status")
        if st == "primary":
            phase = "primary"
        elif st == "final":
            phase = "final"
        else:
            raise HTTPException(status_code=400, detail="Voting is not open for this season")
        entry = await db.game_idea_entries.find_one({"id": body.entry_id, "season_id": season_id}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        if phase == "final" and not entry.get("is_finalist"):
            raise HTTPException(status_code=400, detail="You can only vote for finalists in the final round")
        if entry.get("user_id") == current_user["id"]:
            raise HTTPException(status_code=400, detail="You cannot vote for your own idea")
        now = datetime.now(timezone.utc).isoformat()
        await db.game_idea_votes.update_one(
            {"season_id": season_id, "user_id": current_user["id"], "phase": phase},
            {"$set": {"entry_id": body.entry_id, "updated_at": now}, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        return {"message": "Vote recorded", "phase": phase, "entry_id": body.entry_id}
