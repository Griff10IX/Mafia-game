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

    # Archive fallback: alive victim missing exclusives — use snap list, or pvp_kill rows on killer
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
        if not snap:
            continue
        owned = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].count_documents({"owner_id": vid})
        if owned > 0:
            continue
        strains = list(snap.get("exclusive_weed_strains") or [])
        killer_id = str(snap.get("killer_id") or "")
        if not strains and killer_id:
            held = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
                {
                    "owner_id": killer_id,
                    "$or": [
                        {"previous_owner_id": vid},
                        {"transfer_source": "pvp_kill"},
                    ],
                },
                {"_id": 0, "strain_id": 1},
            ).to_list(20)
            strains = [str(r["strain_id"]) for r in (held or []) if r.get("strain_id")]
        if not strains:
            continue
        by_victim.setdefault(vid, [])
        for sid in strains:
            if sid not in by_victim[vid]:
                by_victim[vid].append(sid)
        if killer_id:
            killer_for[vid] = killer_id

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


async def heal_killer_portfolio_after_revive_clawback(db, *, dry_run: bool = True) -> dict:
    """
    Old revive stole matching property_ids from the killer onto the victim.
    For each archive with killer_id: clone victim's current deeds the killer is missing
    (for property_ids listed in the snapshot) back onto the killer.
    """
    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": []}
    archive_users = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "death_revive_snapshot_archive": {"$exists": True, "$ne": []},
        },
        {"_id": 0, "id": 1, "username": 1, "death_revive_snapshot_archive": 1},
    ).to_list(2000)

    for victim in archive_users:
        snap = _latest_archive_snap(victim)
        if not snap:
            continue
        killer_id = snap.get("killer_id")
        prop_rows = list(snap.get("user_properties") or [])
        if not killer_id or not prop_rows:
            continue
        out["checked"] += 1
        killer = await db.users.find_one(
            {"id": killer_id},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
        )
        if not killer or killer.get("is_dead"):
            continue

        pids = [str(r.get("property_id")) for r in prop_rows if r.get("property_id")]
        if not pids:
            continue
        missing: List[dict] = []
        for pid in pids:
            has = await db.user_properties.find_one(
                {"user_id": killer_id, "property_id": pid}, {"_id": 1}
            )
            if has:
                continue
            victim_row = await db.user_properties.find_one(
                {"user_id": victim["id"], "property_id": pid},
                {"_id": 0},
            )
            if victim_row:
                missing.append(victim_row)
        if not missing:
            continue

        action = {
            "kind": "killer_portfolio_restore",
            "killer_id": killer_id,
            "killer_username": killer.get("username"),
            "victim_id": victim.get("id"),
            "victim_username": victim.get("username"),
            "property_count": len(missing),
            "property_ids": [m.get("property_id") for m in missing],
        }
        if dry_run:
            action["would_apply"] = True
            out["actions"].append(action)
            out["healed"] += 1
            continue
        for row in missing:
            doc = deepcopy(row)
            doc.pop("_id", None)
            doc["user_id"] = killer_id
            doc["id"] = str(uuid.uuid4())
            await db.user_properties.insert_one(doc)
        action["applied"] = True
        out["actions"].append(action)
        out["healed"] += 1
        try:
            from server import send_notification

            await send_notification(
                killer_id,
                "Property portfolio restored",
                (
                    f"Your property deeds taken when {victim.get('username') or 'a player'} "
                    f"revived have been copied back to you. They keep theirs too."
                ),
                "reward",
            )
        except Exception:
            pass

    return out


async def heal_killer_biz_after_revive_revert(db, *, dry_run: bool = True) -> dict:
    """
    Old revive deleted the killer's seized illegal business. If victim is alive with a biz
    and archive killer has none, clone victim's biz to the killer (both keep).
    """
    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": []}
    archive_users = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "death_revive_snapshot_archive": {"$exists": True, "$ne": []},
        },
        {"_id": 0, "id": 1, "username": 1, "death_revive_snapshot_archive": 1},
    ).to_list(2000)

    for victim in archive_users:
        snap = _latest_archive_snap(victim)
        if not snap or not snap.get("illegal_business") or not snap.get("killer_id"):
            continue
        killer_id = str(snap["killer_id"])
        out["checked"] += 1
        killer_biz = await db.illegal_businesses.find_one({"user_id": killer_id}, {"_id": 0, "id": 1})
        if killer_biz:
            continue
        victim_biz = await db.illegal_businesses.find_one({"user_id": victim["id"]}, {"_id": 0})
        if not victim_biz:
            # Fall back to archive snap biz
            victim_biz = snap.get("illegal_business")
            guards = list(snap.get("illegal_business_guards") or [])
        else:
            guards = None
        if not victim_biz:
            continue
        killer = await db.users.find_one(
            {"id": killer_id}, {"_id": 0, "username": 1, "is_dead": 1}
        )
        if not killer or killer.get("is_dead"):
            continue
        action = await _clone_biz_to_victim(
            db,
            victim_id=killer_id,
            source_biz=victim_biz,
            guards=guards,
            dry_run=dry_run,
        )
        action["kind"] = "killer_biz_restore"
        action["killer_username"] = killer.get("username")
        action["victim_username"] = victim.get("username")
        action["username"] = killer.get("username")
        out["actions"].append(action)
        out["healed"] += 1
        if not dry_run and action.get("applied"):
            try:
                from server import send_notification

                await send_notification(
                    killer_id,
                    "Illegal business restored",
                    (
                        f"Your seized business removed when {victim.get('username') or 'a player'} "
                        f"revived has been restored. They keep theirs too."
                    ),
                    "reward",
                )
            except Exception:
                pass

    return out


async def heal_weed_from_revive_sacrifice(db, *, dry_run: bool = True) -> dict:
    """Move exclusive weed strains stuck on £10 revive sacrifice alts onto the revived recipient."""
    from utils.weed_empire_exclusive_strains import (
        EXCLUSIVE_WEED_STRAINS_COLLECTION,
        transfer_exclusive_weed_strains_between_users,
    )

    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": [], "transferred_strains": 0}
    sacrificers = await db.users.find(
        {
            "revive_sacrifice_for_user_id": {"$exists": True, "$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "revive_sacrifice_for_user_id": 1},
    ).to_list(2000)

    for sac in sacrificers:
        out["checked"] += 1
        recipient_id = str(sac.get("revive_sacrifice_for_user_id") or "")
        if not recipient_id:
            continue
        held = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
            {"owner_id": sac["id"]},
            {"_id": 0, "strain_id": 1},
        ).to_list(20)
        if not held:
            continue
        recip = await db.users.find_one(
            {"id": recipient_id}, {"_id": 0, "username": 1, "is_dead": 1}
        )
        if not recip or recip.get("is_dead"):
            continue
        strain_ids = [str(r["strain_id"]) for r in held if r.get("strain_id")]
        action = {
            "kind": "weed_from_revive_sacrifice",
            "dead_username": sac.get("username"),
            "recipient_username": recip.get("username"),
            "strain_ids": strain_ids,
        }
        if dry_run:
            action["would_apply"] = True
            out["actions"].append(action)
            out["healed"] += 1
            out["transferred_strains"] += len(strain_ids)
            continue
        moved = await transfer_exclusive_weed_strains_between_users(
            db,
            from_user_id=sac["id"],
            to_user_id=recipient_id,
            from_username=sac.get("username"),
            to_username=recip.get("username"),
            notify=True,
            transfer_source="revive_sacrifice_heal",
        )
        action["restored"] = moved
        action["applied"] = bool(moved)
        out["actions"].append(action)
        if moved:
            out["healed"] += 1
            out["transferred_strains"] += len(moved)

    return out


async def heal_vip_from_revive_sacrifice(db, *, dry_run: bool = True) -> dict:
    """Move VIP cars stuck on £10 revive sacrifice alts onto the revived recipient."""
    from utils.game_pass_vip_car import (
        GAME_PASS_VIP_CAR_ID,
        transfer_vip_pass_cars_dead_alive,
    )

    out: Dict[str, Any] = {"checked": 0, "healed": 0, "actions": [], "transferred_cars": 0}
    sacrificers = await db.users.find(
        {
            "is_dead": True,
            "revive_sacrifice_for_user_id": {"$exists": True, "$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "username": 1, "revive_sacrifice_for_user_id": 1},
    ).to_list(2000)

    for sac in sacrificers:
        out["checked"] += 1
        recipient_id = str(sac.get("revive_sacrifice_for_user_id") or "")
        if not recipient_id:
            continue
        n = await db.user_cars.count_documents(
            {"user_id": sac["id"], "car_id": GAME_PASS_VIP_CAR_ID}
        )
        if n <= 0:
            continue
        recip = await db.users.find_one(
            {"id": recipient_id}, {"_id": 0, "username": 1, "is_dead": 1}
        )
        if not recip or recip.get("is_dead"):
            continue
        action = {
            "kind": "vip_from_revive_sacrifice",
            "dead_username": sac.get("username"),
            "recipient_username": recip.get("username"),
            "cars": int(n),
        }
        if dry_run:
            action["would_apply"] = True
            out["actions"].append(action)
            out["healed"] += 1
            out["transferred_cars"] += int(n)
            continue
        result = await transfer_vip_pass_cars_dead_alive(
            db,
            dead_user_id=sac["id"],
            recipient_user_id=recipient_id,
            dead_username=sac.get("username"),
            recipient_username=recip.get("username"),
            notify=True,
        )
        moved = int((result or {}).get("transferred_count") or 0)
        action["applied"] = moved > 0
        action["cars"] = moved
        out["actions"].append(action)
        if moved:
            out["healed"] += 1
            out["transferred_cars"] += moved

    return out


async def heal_vip_pass_car_gaps(db, *, dry_run: bool = True) -> dict:
    """
    1) Inheritance stuck cars: existing dead→alive VIP backfill
    2) £10 revive sacrifice alts → revived recipient
    3) Alive users with game_pass_vip_car_granted (or prior VIP events) and 0 car22 → re-grant
    """
    from utils.game_pass_vip_car import (
        backfill_vip_pass_cars_dead_alive,
        ensure_vip_pass_car_on_revive,
        count_user_vip_pass_cars,
    )

    out: Dict[str, Any] = {
        "inheritance_backfill": {},
        "sacrifice_backfill": {},
        "regrant_checked": 0,
        "regrant_healed": 0,
        "regrant_actions": [],
    }

    out["inheritance_backfill"] = await backfill_vip_pass_cars_dead_alive(db, dry_run=dry_run)
    out["sacrifice_backfill"] = await heal_vip_from_revive_sacrifice(db, dry_run=dry_run)

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


async def heal_pair_kill_revive(
    db,
    *,
    killer_username: str,
    victim_username: str,
    dry_run: bool = True,
    claw_killer_weed_to_victim: bool = True,
    reviver_username: Optional[str] = None,
) -> dict:
    """
    Targeted fix for one kill→revive case (e.g. Piece / Chaos, reviver FFS):
    - Clone victim properties killer is missing → killer
    - Clone victim illegal biz → killer if killer has none
    - Claw exclusive weed from killer → victim
    - Move exclusive weed + VIP from £10 sacrifice alt (reviver) → victim
    """
    from utils.weed_empire_exclusive_strains import (
        EXCLUSIVE_WEED_STRAINS_COLLECTION,
        restore_exclusive_weed_strains_on_revive,
        transfer_exclusive_weed_strains_between_users,
    )
    from utils.game_pass_vip_car import ensure_vip_pass_car_on_revive, count_user_vip_pass_cars

    killer = await db.users.find_one(
        {"username": _uname_re(killer_username)},
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
    )
    victim = await db.users.find_one(
        {"username": _uname_re(victim_username)},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "death_revive_snapshot_archive": 1,
            "game_pass_vip_car_granted": 1,
        },
    )
    if not killer:
        return {"ok": False, "error": f"Killer not found: {killer_username}"}
    if not victim:
        return {"ok": False, "error": f"Victim not found: {victim_username}"}

    out: Dict[str, Any] = {
        "ok": True,
        "dry_run": bool(dry_run),
        "killer": killer.get("username"),
        "victim": victim.get("username"),
        "actions": [],
    }
    killer_id = killer["id"]
    victim_id = victim["id"]

    # Resolve £10 sacrifice reviver (explicit username and/or revive_sacrifice_for_user_id)
    reviver_ids: List[str] = []
    if reviver_username and str(reviver_username).strip():
        rev = await db.users.find_one(
            {"username": _uname_re(str(reviver_username).strip())},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not rev:
            return {"ok": False, "error": f"Reviver not found: {reviver_username}"}
        reviver_ids.append(rev["id"])
        out["reviver"] = rev.get("username")
    sac_rows = await db.users.find(
        {"revive_sacrifice_for_user_id": victim_id},
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(50)
    for srow in sac_rows or []:
        if srow.get("id") and srow["id"] not in reviver_ids:
            reviver_ids.append(srow["id"])
            if not out.get("reviver"):
                out["reviver"] = srow.get("username")

    # Properties: clone victim → killer for missing property_ids
    victim_props = await db.user_properties.find({"user_id": victim_id}, {"_id": 0}).to_list(200)
    cloned_props = 0
    for row in victim_props or []:
        pid = row.get("property_id")
        if not pid:
            continue
        has = await db.user_properties.find_one(
            {"user_id": killer_id, "property_id": pid}, {"_id": 1}
        )
        if has:
            continue
        if dry_run:
            cloned_props += 1
            continue
        doc = deepcopy(row)
        doc.pop("_id", None)
        doc["user_id"] = killer_id
        doc["id"] = str(uuid.uuid4())
        await db.user_properties.insert_one(doc)
        cloned_props += 1
    if cloned_props:
        out["actions"].append(
            {
                "kind": "killer_portfolio_restore",
                "property_count": cloned_props,
                "would_apply": dry_run,
                "applied": not dry_run,
            }
        )

    # Illegal biz: both keep
    killer_biz = await db.illegal_businesses.find_one({"user_id": killer_id}, {"_id": 0, "id": 1})
    victim_biz = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0})
    if not killer_biz and victim_biz:
        action = await _clone_biz_to_victim(
            db, victim_id=killer_id, source_biz=victim_biz, dry_run=dry_run
        )
        action["kind"] = "killer_biz_restore"
        out["actions"].append(action)

    # Weed: claw exclusive strain(s) back to victim (aggressive discovery)
    if claw_killer_weed_to_victim:
        from utils.weed_empire_exclusive_strains import (
            EXCLUSIVE_STRAIN_IDS,
            exclusive_strain_display_name,
            is_exclusive_strain_id,
        )

        snap = _latest_archive_snap(victim) or {}
        strain_ids: List[str] = []
        discovery: List[str] = []

        for sid in list(snap.get("exclusive_weed_strains") or []):
            if is_exclusive_strain_id(str(sid)) and str(sid) not in strain_ids:
                strain_ids.append(str(sid))
                discovery.append("archive")

        # Any row still tagged as taken from this victim
        prev_rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
            {"previous_owner_id": victim_id},
            {"_id": 0, "strain_id": 1, "owner_id": 1},
        ).to_list(20)
        for r in prev_rows or []:
            sid = str(r.get("strain_id") or "")
            if sid and sid not in strain_ids:
                strain_ids.append(sid)
                discovery.append("previous_owner_id")

        # Exclusives on killer and on £10 sacrifice reviver(s)
        for source_id, label in [(killer_id, "killer_owned")] + [
            (rid, "reviver_owned") for rid in reviver_ids
        ]:
            held = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
                {"owner_id": source_id},
                {"_id": 0, "strain_id": 1},
            ).to_list(20)
            for r in held or []:
                sid = str(r.get("strain_id") or "")
                if not sid or sid in strain_ids:
                    continue
                strain_ids.append(sid)
                discovery.append(label)

        # Inbox: "Exclusive strain lost" / "You lost {Name} to ..."
        if not strain_ids:
            try:
                notes = await db.notifications.find(
                    {
                        "user_id": victim_id,
                        "title": {"$in": ["Exclusive strain lost", "Exclusive strain taken"]},
                    },
                    {"_id": 0, "message": 1, "title": 1},
                ).sort("created_at", -1).to_list(20)
                name_to_id = {
                    exclusive_strain_display_name(sid).lower(): sid for sid in EXCLUSIVE_STRAIN_IDS
                }
                for n in notes or []:
                    msg = str(n.get("message") or "")
                    for name_l, sid in name_to_id.items():
                        if name_l in msg.lower() and sid not in strain_ids:
                            strain_ids.append(sid)
                            discovery.append("notification")
            except Exception:
                logger.exception("pair heal weed notification scan failed victim=%s", victim_id)

        # Ownership snapshot for admin UI
        all_rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
            {},
            {"_id": 0, "strain_id": 1, "owner_id": 1, "previous_owner_id": 1, "transfer_source": 1},
        ).to_list(20)
        owner_map = {}
        for r in all_rows or []:
            oid = r.get("owner_id")
            uname = None
            if oid:
                u = await db.users.find_one({"id": oid}, {"_id": 0, "username": 1})
                uname = (u or {}).get("username")
            owner_map[str(r.get("strain_id"))] = {
                "owner_id": oid,
                "owner_username": uname,
                "previous_owner_id": r.get("previous_owner_id"),
                "transfer_source": r.get("transfer_source"),
                "name": exclusive_strain_display_name(str(r.get("strain_id") or "")),
            }
        out["exclusive_weed_ownership"] = owner_map

        victim_owned = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].count_documents(
            {"owner_id": victim_id}
        )
        if strain_ids:
            if dry_run:
                out["actions"].append(
                    {
                        "kind": "exclusive_weed_clawback",
                        "strain_ids": strain_ids,
                        "discovery": discovery,
                        "would_apply": True,
                        "current_owners": {
                            sid: owner_map.get(sid) for sid in strain_ids
                        },
                    }
                )
            else:
                restored_all: List[str] = []
                # Prefer moving from reviver alts first (FFS → Chaos), then killer clawback
                for rid in reviver_ids:
                    moved = await transfer_exclusive_weed_strains_between_users(
                        db,
                        from_user_id=rid,
                        to_user_id=victim_id,
                        notify=True,
                        transfer_source="revive_sacrifice_heal",
                    )
                    restored_all.extend(moved or [])
                still = [s for s in strain_ids if s not in restored_all]
                if still:
                    moved2 = await restore_exclusive_weed_strains_on_revive(
                        db,
                        victim_id=victim_id,
                        killer_id=killer_id,
                        strain_ids=still,
                        exclusive_stash=snap.get("exclusive_weed_stash") or {},
                        notify=True,
                    )
                    restored_all.extend(moved2 or [])
                # Unique preserve order
                seen = set()
                restored = []
                for s in restored_all:
                    if s not in seen:
                        seen.add(s)
                        restored.append(s)
                out["actions"].append(
                    {
                        "kind": "exclusive_weed_clawback",
                        "strain_ids": strain_ids,
                        "discovery": discovery,
                        "restored": restored,
                        "applied": bool(restored),
                    }
                )
        elif victim_owned <= 0:
            out["actions"].append(
                {
                    "kind": "exclusive_weed_clawback",
                    "strain_ids": [],
                    "skipped_reason": (
                        "No exclusive strain found on killer/reviver, in archive, previous_owner_id, "
                        "or victim loss notifications. Check exclusive_weed_ownership in response."
                    ),
                    "would_apply": False,
                }
            )

        # Explicit reviver→victim weed even if discovery missed strain_ids (FFS still holding)
        for rid in reviver_ids:
            held_n = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].count_documents({"owner_id": rid})
            if held_n <= 0:
                continue
            if dry_run:
                # Already covered if discovery found them; otherwise add action
                if not any(a.get("kind") == "exclusive_weed_clawback" and a.get("strain_ids") for a in out["actions"]):
                    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
                        {"owner_id": rid}, {"_id": 0, "strain_id": 1}
                    ).to_list(20)
                    out["actions"].append(
                        {
                            "kind": "weed_from_revive_sacrifice",
                            "strain_ids": [str(r["strain_id"]) for r in rows if r.get("strain_id")],
                            "would_apply": True,
                        }
                    )
            elif not any(
                a.get("kind") == "exclusive_weed_clawback" and a.get("applied") for a in out["actions"]
            ):
                moved = await transfer_exclusive_weed_strains_between_users(
                    db,
                    from_user_id=rid,
                    to_user_id=victim_id,
                    notify=True,
                    transfer_source="revive_sacrifice_heal",
                )
                if moved:
                    out["actions"].append(
                        {
                            "kind": "weed_from_revive_sacrifice",
                            "strain_ids": moved,
                            "restored": moved,
                            "applied": True,
                        }
                    )

    # VIP from sacrifice alts for this victim + ensure on victim
    from utils.game_pass_vip_car import GAME_PASS_VIP_CAR_ID, transfer_vip_pass_cars_dead_alive

    sacrificers = await db.users.find(
        {"is_dead": True, "revive_sacrifice_for_user_id": victim_id},
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(50)
    for srow in sacrificers:
        n = await db.user_cars.count_documents(
            {"user_id": srow["id"], "car_id": GAME_PASS_VIP_CAR_ID}
        )
        if n <= 0:
            continue
        if dry_run:
            out["actions"].append(
                {
                    "kind": "vip_from_revive_sacrifice",
                    "dead_username": srow.get("username"),
                    "cars": n,
                    "would_apply": True,
                }
            )
        else:
            xfer = await transfer_vip_pass_cars_dead_alive(
                db,
                dead_user_id=srow["id"],
                recipient_user_id=victim_id,
                dead_username=srow.get("username"),
                recipient_username=victim.get("username"),
                notify=True,
            )
            out["actions"].append(
                {
                    "kind": "vip_from_revive_sacrifice",
                    "dead_username": srow.get("username"),
                    "cars": int((xfer or {}).get("transferred_count") or 0),
                    "applied": True,
                }
            )

    vip_count = await count_user_vip_pass_cars(db, victim_id)
    if vip_count <= 0 and (
        victim.get("game_pass_vip_car_granted")
        or sacrificers
        or await db.exclusive_car_events.find_one(
            {"car_id": GAME_PASS_VIP_CAR_ID, "to_user_id": victim_id}, {"_id": 1}
        )
    ):
        if dry_run:
            out["actions"].append({"kind": "vip_pass_car_regrant", "would_apply": True})
        else:
            ok = await ensure_vip_pass_car_on_revive(db, user_id=victim_id)
            out["actions"].append({"kind": "vip_pass_car_regrant", "applied": bool(ok)})

    out["action_count"] = len(out["actions"])
    return out


def _uname_re(name: str):
    import re

    return re.compile("^" + re.escape((name or "").strip()) + "$", re.IGNORECASE)


def _distillery_steps(biz: Optional[dict]) -> int:
    dist = (biz or {}).get("distillery") or {}
    equipment = dist.get("equipment") or {}
    specials = dist.get("special_upgrades") or {}
    eq = sum(int(equipment.get(k) or 0) for k in equipment) if isinstance(equipment, dict) else 0
    sp = sum(1 for v in (specials.values() if isinstance(specials, dict) else []) if v)
    return int(eq + sp)


def _biz_progress_summary(biz: Optional[dict], *, guards: int = 0) -> Dict[str, Any]:
    if not biz:
        return {
            "present": False,
            "type": None,
            "name": None,
            "level": 0,
            "security_level": 0,
            "vault": 0,
            "income_per_hour": 0,
            "guards": 0,
            "distillery_steps": 0,
        }
    sec = len(biz.get("security_upgrades") or []) or int(biz.get("security_level") or 0)
    return {
        "present": True,
        "type": biz.get("type") or biz.get("business_type"),
        "name": biz.get("name"),
        "level": int(biz.get("level") or 1),
        "security_level": int(sec),
        "vault": int(biz.get("vault") or 0),
        "income_per_hour": int(biz.get("income_per_hour") or 0),
        "guards": int(guards),
        "distillery_steps": _distillery_steps(biz),
    }


def _resolve_vault(current_vault: int, archive_vault: int, vault_policy: str) -> int:
    policy = (vault_policy or "max").strip().lower()
    if policy == "archive":
        return int(archive_vault)
    if policy == "current":
        return int(current_vault)
    # default max — never wipe a larger live vault on restore
    return max(int(current_vault), int(archive_vault))


async def force_restore_illegal_business_from_archive(
    db,
    *,
    username: str,
    archive_username: Optional[str] = None,
    dry_run: bool = True,
    vault_policy: str = "max",
    restore_ibm_missions: bool = True,
) -> dict:
    """
    Overwrite a player's illegal business (Speakeasy/distillery/guards) from a death archive.

    Use when a wiped Level-1 shell already exists so normal revive/heal skips restore.
    For kill→revive (e.g. Piece ← Chaos archive): set username=Piece, archive_username=Chaos.
    """
    target_name = (username or "").strip()
    archive_name = (archive_username or username or "").strip()
    if not target_name:
        return {"ok": False, "error": "username required"}

    target = await db.users.find_one(
        {"username": _uname_re(target_name)},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "illegal_business_mission_completions": 1,
            "illegal_business_mission_baselines": 1,
        },
    )
    if not target:
        return {"ok": False, "error": f"User not found: {target_name}"}

    archive_user = target
    if archive_name.lower() != target_name.lower():
        archive_user = await db.users.find_one(
            {"username": _uname_re(archive_name)},
            {"_id": 0, "id": 1, "username": 1, "death_revive_snapshot_archive": 1},
        )
        if not archive_user:
            return {"ok": False, "error": f"Archive user not found: {archive_name}"}
    else:
        archive_user = await db.users.find_one(
            {"id": target["id"]},
            {"_id": 0, "id": 1, "username": 1, "death_revive_snapshot_archive": 1},
        )

    snap = _latest_archive_snap(archive_user or {})
    if not snap:
        return {
            "ok": False,
            "error": f"No death_revive_snapshot_archive on {archive_user.get('username') or archive_name}",
        }

    snap_biz = snap.get("illegal_business")
    if not snap_biz:
        return {
            "ok": False,
            "error": (
                f"Archive for {archive_user.get('username') or archive_name} "
                "has no illegal_business snapshot"
            ),
            "archive_captured_at": snap.get("captured_at") or snap.get("archived_at"),
        }

    snap_guards = list(snap.get("illegal_business_guards") or [])
    target_id = target["id"]
    current = await db.illegal_businesses.find_one({"user_id": target_id}, {"_id": 0})
    current_guards = []
    if current and current.get("id"):
        current_guards = await db.illegal_business_guards.find(
            {"business_id": current["id"]}, {"_id": 0}
        ).to_list(2000)

    current_vault = int((current or {}).get("vault") or 0)
    archive_vault = int(snap_biz.get("vault") or 0)
    resolved_vault = _resolve_vault(current_vault, archive_vault, vault_policy)

    ibm_snap = snap.get("user_ibm_fields") or {}
    ibm_missions = list(ibm_snap.get("illegal_business_mission_completions") or [])
    current_missions = list(target.get("illegal_business_mission_completions") or [])

    before = _biz_progress_summary(current, guards=len(current_guards))
    after = _biz_progress_summary(snap_biz, guards=len(snap_guards))
    after["vault"] = resolved_vault

    out: Dict[str, Any] = {
        "ok": True,
        "dry_run": bool(dry_run),
        "username": target.get("username"),
        "user_id": target_id,
        "archive_username": archive_user.get("username"),
        "archive_user_id": archive_user.get("id"),
        "archive_captured_at": snap.get("captured_at") or snap.get("archived_at"),
        "vault_policy": (vault_policy or "max").strip().lower(),
        "vault_current": current_vault,
        "vault_archive": archive_vault,
        "vault_resolved": resolved_vault,
        "restore_ibm_missions": bool(restore_ibm_missions),
        "ibm_missions_current": len(current_missions),
        "ibm_missions_archive": len(ibm_missions),
        "before": before,
        "after": after,
        "mode": "overwrite" if current else "insert",
        "applied": False,
    }

    if dry_run:
        out["would_apply"] = True
        return out

    biz_doc = deepcopy(snap_biz)
    biz_doc.pop("_id", None)
    biz_doc.pop("seized_from_user_id", None)
    biz_doc["user_id"] = target_id
    biz_doc["vault"] = resolved_vault

    if current and current.get("id"):
        biz_id = current["id"]
        biz_doc["id"] = biz_id
        # Keep row identity; replace payload.
        await db.illegal_businesses.replace_one(
            {"user_id": target_id, "id": biz_id},
            biz_doc,
            upsert=True,
        )
        await db.illegal_business_guards.delete_many({"business_id": biz_id})
    else:
        biz_id = str(uuid.uuid4())
        biz_doc["id"] = biz_id
        await db.illegal_businesses.insert_one(biz_doc)

    for g in snap_guards:
        gd = dict(g)
        gd.pop("_id", None)
        gd["id"] = str(uuid.uuid4())
        gd["business_id"] = biz_id
        await db.illegal_business_guards.insert_one(gd)

    if restore_ibm_missions and ibm_snap:
        set_doc = {k: v for k, v in ibm_snap.items() if k in (
            "illegal_business_mission_completions",
            "illegal_business_mission_baselines",
        )}
        if set_doc:
            await db.users.update_one({"id": target_id}, {"$set": set_doc})
            out["ibm_fields_restored"] = True

    # Keep last few backups for undo / audit
    backup = {
        "at": _utc_now_iso(),
        "archive_username": archive_user.get("username"),
        "archive_captured_at": snap.get("captured_at") or snap.get("archived_at"),
        "biz": current,
        "guards": current_guards,
        "ibm_missions_count": len(current_missions),
    }
    try:
        await db.users.update_one(
            {"id": target_id},
            {
                "$push": {
                    "illegal_business_force_restore_backups": {
                        "$each": [backup],
                        "$slice": -5,
                    }
                }
            },
        )
    except Exception:
        logger.exception(
            "force_restore biz backup push failed user=%s", target_id
        )

    out["applied"] = True
    out["business_id"] = biz_id
    out["guards_restored"] = len(snap_guards)
    return out


async def run_dead_alive_estate_heal(db, *, dry_run: bool = True) -> dict:
    """Full estate heal pass (biz + weed + VIP + killer portfolio/biz)."""
    started = _utc_now_iso()
    biz = await heal_illegal_business_gaps(db, dry_run=dry_run)
    killer_biz = await heal_killer_biz_after_revive_revert(db, dry_run=dry_run)
    killer_props = await heal_killer_portfolio_after_revive_clawback(db, dry_run=dry_run)
    weed = await heal_exclusive_weed_gaps(db, dry_run=dry_run)
    weed_sac = await heal_weed_from_revive_sacrifice(db, dry_run=dry_run)
    vip = await heal_vip_pass_car_gaps(db, dry_run=dry_run)
    return {
        "dry_run": bool(dry_run),
        "started_at": started,
        "finished_at": _utc_now_iso(),
        "illegal_business": biz,
        "killer_illegal_business": killer_biz,
        "killer_portfolio": killer_props,
        "exclusive_weed": weed,
        "weed_from_sacrifice": weed_sac,
        "vip_pass_car": vip,
        "totals": {
            "biz_healed": int(biz.get("healed") or 0),
            "killer_biz_healed": int(killer_biz.get("healed") or 0),
            "killer_portfolio_healed": int(killer_props.get("healed") or 0),
            "weed_healed": int(weed.get("healed") or 0),
            "weed_sacrifice_healed": int(weed_sac.get("healed") or 0),
            "weed_sacrifice_strains": int(weed_sac.get("transferred_strains") or 0),
            "vip_regrant_healed": int(vip.get("regrant_healed") or 0),
            "vip_inheritance_cars": int(
                (vip.get("inheritance_backfill") or {}).get("transferred_cars") or 0
            ),
            "vip_sacrifice_cars": int(
                (vip.get("sacrifice_backfill") or {}).get("transferred_cars") or 0
            ),
        },
    }
