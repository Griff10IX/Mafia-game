"""Admin / backfill heal for Dead → Alive estate gaps (biz, weed specials, VIP car)."""
from __future__ import annotations

import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _latest_archive_snap(user: dict) -> Optional[dict]:
    archive = user.get("death_revive_snapshot_archive") or []
    if not archive:
        return None
    # Prefer newest archived_at; fall back to last list entry.
    best = None
    best_at = ""
    for entry in archive:
        if not isinstance(entry, dict):
            continue
        at = str(entry.get("archived_at") or entry.get("captured_at") or "")
        if not best or at >= best_at:
            best = entry
            best_at = at
    return best or (archive[-1] if isinstance(archive[-1], dict) else None)


async def _clone_biz_to_victim(
    db,
    *,
    victim_id: str,
    source_biz: dict,
    guards: Optional[List[dict]] = None,
    dry_run: bool,
) -> dict:
    """Insert a copy of source_biz for victim with new ids. Does not touch the source."""
    action = {
        "victim_id": victim_id,
        "kind": "illegal_business_clone",
        "source_biz_id": source_biz.get("id"),
        "source_user_id": source_biz.get("user_id"),
    }
    if dry_run:
        action["would_apply"] = True
        return action

    biz_doc = deepcopy(source_biz)
    biz_doc.pop("_id", None)
    new_id = str(uuid.uuid4())
    biz_doc["id"] = new_id
    biz_doc["user_id"] = victim_id
    biz_doc.pop("seized_from_user_id", None)
    await db.illegal_businesses.insert_one(biz_doc)

    if guards is None:
        guards = await db.illegal_business_guards.find(
            {"business_id": source_biz.get("id")}, {"_id": 0}
        ).to_list(2000)
    for g in guards or []:
        gd = dict(g)
        gd.pop("_id", None)
        gd["id"] = str(uuid.uuid4())
        gd["business_id"] = new_id
        await db.illegal_business_guards.insert_one(gd)

    action["new_biz_id"] = new_id
    action["applied"] = True
    return action


async def heal_illegal_business_gaps(db, *, dry_run: bool = True) -> dict:
    """
    Alive users with no illegal_businesses row:
    - Prefer restore from death_revive_snapshot_archive
    - Else clone from killer's seized biz (seized_from_user_id == victim)
    Both keep a business (clone with new ids).
    """
    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": []}

    seized_cursor = db.illegal_businesses.find(
        {"seized_from_user_id": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0},
    )
    seized_rows = await seized_cursor.to_list(5000)
    victim_ids = {str(r.get("seized_from_user_id")) for r in seized_rows if r.get("seized_from_user_id")}

    # Also consider alive users with archive biz but no current biz
    archive_users = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "death_revive_snapshot_archive": {"$exists": True, "$ne": []},
        },
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "death_revive_snapshot_archive": 1},
    ).to_list(2000)
    for u in archive_users:
        if u.get("id"):
            victim_ids.add(str(u["id"]))

    for victim_id in sorted(victim_ids):
        out["checked"] += 1
        user = await db.users.find_one(
            {"id": victim_id},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "is_dead": 1,
                "death_revive_snapshot_archive": 1,
            },
        )
        if not user or user.get("is_dead"):
            continue
        existing = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0, "id": 1})
        if existing:
            continue

        snap = _latest_archive_snap(user)
        snap_biz = (snap or {}).get("illegal_business") if snap else None
        if snap_biz:
            action = await _clone_biz_to_victim(
                db,
                victim_id=victim_id,
                source_biz=snap_biz,
                guards=list((snap or {}).get("illegal_business_guards") or []),
                dry_run=dry_run,
            )
            action["username"] = user.get("username")
            action["kind"] = "illegal_business_from_archive"
            out["actions"].append(action)
            out["healed"] += 1
            continue

        seized = await db.illegal_businesses.find_one(
            {"seized_from_user_id": victim_id},
            {"_id": 0},
        )
        if not seized:
            continue
        action = await _clone_biz_to_victim(
            db,
            victim_id=victim_id,
            source_biz=seized,
            dry_run=dry_run,
        )
        action["username"] = user.get("username")
        out["actions"].append(action)
        out["healed"] += 1

    return out


async def heal_exclusive_weed_gaps(db, *, dry_run: bool = True) -> dict:
    """
    Alive users with previous_owner_id on exclusive_weed_strains (or archive snap strains)
    who do not currently own those strains → claw back.
    """
    from utils.weed_empire_exclusive_strains import (
        EXCLUSIVE_WEED_STRAINS_COLLECTION,
        restore_exclusive_weed_strains_on_revive,
    )

    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": []}

    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {
            "previous_owner_id": {"$exists": True, "$nin": [None, ""]},
            "transfer_source": "pvp_kill",
        },
        {"_id": 0, "strain_id": 1, "owner_id": 1, "previous_owner_id": 1},
    ).to_list(100)

    by_victim: Dict[str, List[str]] = {}
    killer_for: Dict[str, str] = {}
    for r in rows or []:
        victim_id = str(r.get("previous_owner_id") or "")
        sid = str(r.get("strain_id") or "")
        if not victim_id or not sid:
            continue
        if r.get("owner_id") == victim_id:
            continue
        by_victim.setdefault(victim_id, []).append(sid)
        if r.get("owner_id"):
            killer_for[victim_id] = str(r["owner_id"])

    # Archive fallback: alive user empty exclusives but archive lists strains
    archive_users = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "death_revive_snapshot_archive": {"$exists": True, "$ne": []},
        },
        {"_id": 0, "id": 1, "username": 1, "death_revive_snapshot_archive": 1},
    ).to_list(2000)
    for u in archive_users:
        vid = str(u.get("id") or "")
        if not vid:
            continue
        snap = _latest_archive_snap(u)
        strains = list((snap or {}).get("exclusive_weed_strains") or [])
        if not strains:
            continue
        owned = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].count_documents({"owner_id": vid})
        if owned > 0:
            continue
        by_victim.setdefault(vid, [])
        for sid in strains:
            if sid not in by_victim[vid]:
                by_victim[vid].append(sid)
        if (snap or {}).get("killer_id"):
            killer_for[vid] = str(snap["killer_id"])

    for victim_id, strain_ids in by_victim.items():
        out["checked"] += 1
        user = await db.users.find_one(
            {"id": victim_id},
            {"_id": 0, "username": 1, "is_dead": 1, "death_revive_snapshot_archive": 1},
        )
        if not user or user.get("is_dead"):
            continue
        # Skip if they already own all listed strains
        still_missing = []
        for sid in strain_ids:
            row = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find_one(
                {"strain_id": sid},
                {"_id": 0, "owner_id": 1},
            )
            if not row or row.get("owner_id") != victim_id:
                still_missing.append(sid)
        if not still_missing:
            continue

        snap = _latest_archive_snap(user) or {}
        stash = snap.get("exclusive_weed_stash") or {}
        action = {
            "victim_id": victim_id,
            "username": user.get("username"),
            "kind": "exclusive_weed_clawback",
            "strain_ids": still_missing,
        }
        if dry_run:
            action["would_apply"] = True
            out["actions"].append(action)
            out["healed"] += 1
            continue
        try:
            restored = await restore_exclusive_weed_strains_on_revive(
                db,
                victim_id=victim_id,
                killer_id=killer_for.get(victim_id) or snap.get("killer_id"),
                strain_ids=still_missing,
                exclusive_stash=stash if isinstance(stash, dict) else None,
                notify=True,
            )
            action["restored"] = restored
            action["applied"] = bool(restored)
            out["actions"].append(action)
            if restored:
                out["healed"] += 1
        except Exception:
            logger.exception("estate heal weed failed victim=%s", victim_id)
            action["error"] = True
            out["actions"].append(action)

    return out


async def heal_vip_pass_car_gaps(db, *, dry_run: bool = True) -> dict:
    """
    1) Inheritance stuck cars: existing dead→alive VIP backfill
    2) Alive users with game_pass_vip_car_granted (or prior VIP events) and 0 car22 → re-grant
    """
    from utils.game_pass_vip_car import (
        backfill_vip_pass_cars_dead_alive,
        ensure_vip_pass_car_on_revive,
        count_user_vip_pass_cars,
    )

    out: Dict[str, Any] = {
        "inheritance_backfill": {},
        "regrant_checked": 0,
        "regrant_healed": 0,
        "regrant_actions": [],
    }

    out["inheritance_backfill"] = await backfill_vip_pass_cars_dead_alive(db, dry_run=dry_run)

    candidates = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "game_pass_vip_car_granted": True,
        },
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(5000)

    for u in candidates:
        uid = u.get("id")
        if not uid:
            continue
        out["regrant_checked"] += 1
        n = await count_user_vip_pass_cars(db, uid)
        if n > 0:
            continue
        action = {
            "user_id": uid,
            "username": u.get("username"),
            "kind": "vip_pass_car_regrant",
        }
        if dry_run:
            action["would_apply"] = True
            out["regrant_actions"].append(action)
            out["regrant_healed"] += 1
            continue
        ok = await ensure_vip_pass_car_on_revive(db, user_id=uid)
        action["applied"] = bool(ok)
        out["regrant_actions"].append(action)
        if ok:
            out["regrant_healed"] += 1

    return out


async def run_dead_alive_estate_heal(db, *, dry_run: bool = True) -> dict:
    """Full estate heal pass (biz + weed + VIP)."""
    started = _utc_now_iso()
    biz = await heal_illegal_business_gaps(db, dry_run=dry_run)
    weed = await heal_exclusive_weed_gaps(db, dry_run=dry_run)
    vip = await heal_vip_pass_car_gaps(db, dry_run=dry_run)
    return {
        "dry_run": bool(dry_run),
        "started_at": started,
        "finished_at": _utc_now_iso(),
        "illegal_business": biz,
        "exclusive_weed": weed,
        "vip_pass_car": vip,
        "totals": {
            "biz_healed": int(biz.get("healed") or 0),
            "weed_healed": int(weed.get("healed") or 0),
            "vip_regrant_healed": int(vip.get("regrant_healed") or 0),
            "vip_inheritance_cars": int(
                (vip.get("inheritance_backfill") or {}).get("transferred_cars") or 0
            ),
        },
    }
