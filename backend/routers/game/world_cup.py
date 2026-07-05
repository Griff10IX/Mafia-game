# World Cup 2026 predictions event
import asyncio
import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.casinos import sports_betting as sb
from utils.point_provenance import log_points_event
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_WORLD_CUP

logger = logging.getLogger(__name__)

CONFIG_ID = "world_cup_event"
WC_TEAMS_SEED_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "world_cup_2026_teams.json"
WC_SPORT_KEY = "soccer_fifa_world_cup"
LOCK_MINUTES_BEFORE = 10
SETTLE_MINUTES_AFTER = 122
DRAFT_HOURS_BEFORE_START = 24
DEFAULT_ENDED_MESSAGE = "World Cup 2026 has ended. Thanks for playing!"
GROUP_IDS = tuple(chr(ord("A") + i) for i in range(12))

WC_PLAYOFF_PLACEHOLDER_NAMES = {
    "PO-A": "Winner Playoff A",
    "PO-B": "Winner Playoff B",
    "PO-C": "Winner Playoff C",
    "PO-D": "Winner Playoff D",
    "PO-E": "Winner Playoff E",
}

WC_PLAYOFF_RESOLUTIONS: Dict[str, Dict[str, Any]] = {
    "PO-A": {
        "name": "Bosnia and Herzegovina",
        "short_code": "BIH",
        "flag_emoji": "🇧🇦",
        "odds_api_names": ["Bosnia and Herzegovina", "Bosnia"],
        "group_id": "B",
    },
    "PO-B": {
        "name": "Iraq",
        "short_code": "IRQ",
        "flag_emoji": "🇮🇶",
        "odds_api_names": ["Iraq"],
        "group_id": "I",
    },
    "PO-C": {
        "name": "Türkiye",
        "short_code": "TUR",
        "flag_emoji": "🇹🇷",
        "odds_api_names": ["Turkey", "Türkiye"],
        "group_id": "D",
    },
    "PO-D": {
        "name": "Czechia",
        "short_code": "CZE",
        "flag_emoji": "🇨🇿",
        "odds_api_names": ["Czechia", "Czech Republic"],
        "group_id": "A",
    },
    "PO-E": {
        "name": "DR Congo",
        "short_code": "COD",
        "flag_emoji": "🇨🇩",
        "odds_api_names": ["DR Congo", "Congo DR", "Democratic Republic of the Congo"],
        "group_id": "K",
    },
}

PRED_GROUP_WINNER = "group_winner"
PRED_MATCH_SCORE = "match_score"
PRED_MATCH_SCORER = "match_scorer"
PRED_SECOND_PLACE = "second_place"
PRED_THIRD_PLACE = "third_place"
WC_PICK_SNAPSHOT_COL = "world_cup_group_pick_snapshots"

DEFAULT_POINTS = {
    "group_winner_points": 2500,
    "jackpot_points": 25000,
    "second_place_points": 15000,
    "third_place_points": 10000,
    "match_score_exact_points": 1000,
    "match_score_result_points": 250,
    "match_scorer_points": 500,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


async def _load_config(db) -> dict:
    doc = await db.game_config.find_one({"id": CONFIG_ID}, {"_id": 0})
    if not doc:
        doc = {"id": CONFIG_ID, "enabled": False, "ended_message": DEFAULT_ENDED_MESSAGE}
    out = dict(doc)
    for k, v in DEFAULT_POINTS.items():
        out.setdefault(k, v)
    out.setdefault("enabled", False)
    out.setdefault("entry_open", True)
    out.setdefault("draft_run", False)
    out.setdefault("auto_sync_enabled", True)
    out.setdefault("ended_message", DEFAULT_ENDED_MESSAGE)
    out.setdefault("phase", "upcoming")
    out.setdefault("banner_text", "")
    return out


async def _require_enabled(cfg: dict, *, admin_ok: bool = False) -> None:
    if cfg.get("enabled"):
        return
    if admin_ok:
        return
    raise HTTPException(status_code=403, detail=cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE)


def _can_enter_event(cfg: dict, entry: Optional[dict]) -> bool:
    """Whether this user may join (or has already joined) the World Cup event."""
    if entry:
        return False
    if not cfg.get("enabled"):
        return False
    if cfg.get("entry_open", True):
        return True
    # After the team draft closes entry_open, still allow late join for match/group predictions (no raffle teams).
    return bool(cfg.get("draft_run"))


def _late_entry_only(cfg: dict) -> bool:
    return bool(cfg.get("draft_run")) and not cfg.get("entry_open", True)


async def _require_enabled_staff(cfg: dict) -> None:
    if not cfg.get("enabled"):
        raise HTTPException(status_code=403, detail="World Cup event is disabled")


def _points_from_config(cfg: dict) -> dict:
    return {k: int(cfg.get(k) or v) for k, v in DEFAULT_POINTS.items()}


async def _award_points(
    db,
    send_notification,
    user_id: str,
    points: int,
    event_ref: str,
    label: str,
    *,
    pred: Optional[dict] = None,
) -> bool:
    pts = int(points or 0)
    if not user_id or pts <= 0:
        return False
    if event_ref:
        existing = await db.point_ledger_events.find_one(
            {
                "event_type": "world_cup_payout",
                "origin_ref": event_ref,
                "user_id": user_id,
                "points": pts,
            },
            {"_id": 0, "id": 1},
        )
        if existing:
            return False
    await db.users.update_one({"id": user_id}, {"$inc": {"points": pts}})
    await log_points_event(
        db,
        user_id=user_id,
        points=pts,
        event_type="world_cup_payout",
        event_ref=event_ref,
        meta={"label": label, "prediction_type": (pred or {}).get("type")},
    )
    notify_pred = pred if pred else {"user_id": user_id}
    await _notify_wc_prediction_result(db, send_notification, notify_pred, pts, label, paid=True)
    return True


async def _notify_wc_prediction_result(
    db,
    send_notification,
    pred: dict,
    points: int,
    label: str,
    *,
    paid: bool,
) -> None:
    pts = int(points or 0)
    if pts <= 0:
        return
    uid = pred.get("user_id") or ""
    if not uid or await _is_ghost_user(db, uid):
        return
    ptype = pred.get("type") or ""
    gid = (pred.get("target_id") or "").strip().upper() if ptype == PRED_GROUP_WINNER else ""
    try:
        if paid:
            title = "World Cup — points received"
            if ptype == PRED_GROUP_WINNER and gid:
                msg = f"You received {pts:,} points for your correct Group {gid} winner pick."
            else:
                msg = f"You received {pts:,} points — {label}."
            await send_notification(uid, title, msg, "reward", category="world_cup")
        else:
            title = "World Cup — correct pick"
            if ptype == PRED_GROUP_WINNER and gid:
                msg = f"Correct Group {gid} winner! {pts:,} points are queued for staff approval."
            else:
                msg = f"Correct prediction ({label}) — {pts:,} points queued for staff approval."
            await send_notification(uid, title, msg, "info", category="world_cup")
    except Exception:
        pass


async def _user_wc_earnings(db, user_id: str, cfg: dict, entry: Optional[dict] = None) -> dict:
    """Paid / pending / total World Cup points for a player."""
    paid = 0
    pending = 0
    group_paid = 0
    group_pending = 0
    if user_id:
        async for p in db.world_cup_predictions.find(
            {"user_id": user_id, "settled": True, "points_awarded": {"$gt": 0}},
            {"_id": 0, "type": 1, "points_awarded": 1, "payout_status": 1},
        ):
            pts = int(p.get("points_awarded") or 0)
            ps = p.get("payout_status")
            if ps == "pending":
                pending += pts
                if p.get("type") == PRED_GROUP_WINNER:
                    group_pending += pts
            elif ps != "ghost":
                paid += pts
                if p.get("type") == PRED_GROUP_WINNER:
                    group_paid += pts
    if entry is None and user_id:
        entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    jackpot_paid = 0
    jackpot_pending = 0
    if entry:
        jp = _points_from_config(cfg)["jackpot_points"]
        if entry.get("jackpot_pending"):
            jackpot_pending = jp
            pending += jp
        elif entry.get("jackpot_awarded"):
            jackpot_paid = jp
            paid += jp
    return {
        "points_paid": paid,
        "points_pending": pending,
        "points_earned_total": paid + pending,
        "group_winner_points_paid": group_paid,
        "group_winner_points_pending": group_pending,
        "jackpot_points_paid": jackpot_paid,
        "jackpot_points_pending": jackpot_pending,
    }


async def _is_ghost_user(db, user_id: str) -> bool:
    if not user_id:
        return False
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"ghost_entry": 1})
    return bool(entry and entry.get("ghost_entry"))


async def _ghost_user_ids(db) -> set:
    ids = set()
    async for entry in db.world_cup_entries.find({"ghost_entry": True}, {"user_id": 1}):
        uid = entry.get("user_id")
        if uid:
            ids.add(uid)
    return ids


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _stable_wc_team_id(short_code: str) -> str:
    sc = (short_code or "").strip().upper()
    return f"wc26-{sc}" if sc else str(uuid.uuid4())


def _load_seed_teams_data() -> dict:
    path = WC_TEAMS_SEED_PATH
    if not path.is_file():
        raise HTTPException(status_code=500, detail=f"Seed file not found: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _seed_file_team_ids_in_order(data: Optional[dict] = None) -> List[str]:
    payload = data if data is not None else _load_seed_teams_data()
    out: List[str] = []
    for grp in payload.get("groups") or []:
        for t in grp.get("teams") or []:
            sc = (t.get("short_code") or "").strip().upper()
            if sc:
                out.append(_stable_wc_team_id(sc))
    return out


_DRAFT_NOTIFY_RE = re.compile(
    r"Team draft complete — you were assigned (\d+) nation\(s\): (.+?)\.?\s*$",
    re.IGNORECASE,
)


async def _collect_old_team_id_to_name(db) -> Dict[str, str]:
    """Map pre-reseed team UUIDs to names using draft inbox notifications."""
    mapping: Dict[str, str] = {}
    draft_names = await _draft_names_by_user(db)
    async for entry in db.world_cup_entries.find({}, {"_id": 0, "user_id": 1, "drafted_team_ids": 1}):
        uid = entry.get("user_id")
        names = draft_names.get(uid) or []
        old_ids = entry.get("drafted_team_ids") or []
        for i, oid in enumerate(old_ids):
            if not oid or not _is_legacy_team_id(oid):
                continue
            if i < len(names) and names[i]:
                mapping.setdefault(str(oid), names[i])
    return mapping


async def _legacy_to_stable_from_draft_snapshot(db) -> Dict[str, str]:
    """Map legacy UUIDs to stable ids when draft_source_team_ids was saved at draft time."""
    cfg = await _load_config(db)
    legacy_order = list(cfg.get("draft_source_team_ids") or [])
    stable_order = _seed_file_team_ids_in_order()
    if not legacy_order or len(legacy_order) != len(stable_order):
        return {}
    out: Dict[str, str] = {}
    for i, leg in enumerate(legacy_order):
        if _is_legacy_team_id(leg):
            out[str(leg)] = stable_order[i]
    return out


async def _users_by_legacy_group_pick(db, group_id: str) -> Dict[str, List[str]]:
    """legacy team_id → user ids who picked it for this group."""
    by_legacy: Dict[str, List[str]] = {}
    gid = (group_id or "").strip().upper()
    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "target_id": gid, "value.team_id": {"$exists": True}},
        {"_id": 0, "user_id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if not _is_legacy_team_id(tid):
            continue
        uid = p.get("user_id")
        if not uid:
            continue
        by_legacy.setdefault(str(tid), []).append(uid)
    return by_legacy


def _legacy_stable_overlap_score(
    legacy_id: str,
    stable_id: str,
    replay: Dict[str, List[str]],
    draft_names: Dict[str, List[str]],
    teams_by_id: dict,
    preds_by_legacy: Dict[str, List[str]],
) -> int:
    team = teams_by_id.get(stable_id) or {}
    team_name = _norm_name(team.get("name") or "")
    pts = 0
    for uid in preds_by_legacy.get(legacy_id) or []:
        assigned = replay.get(uid) or []
        if stable_id in assigned:
            pts += 3
        names = draft_names.get(uid) or []
        try:
            idx = assigned.index(stable_id)
            if idx < len(names) and _norm_name(names[idx]) == team_name:
                pts += 1
        except ValueError:
            pass
    return pts


def _greedy_legacy_stable_match(
    legacy_ids: List[str],
    stable_ids: List[str],
    replay: Dict[str, List[str]],
    draft_names: Dict[str, List[str]],
    teams_by_id: dict,
    preds_by_legacy: Dict[str, List[str]],
) -> Dict[str, str]:
    """Assign legacy UUIDs to stable team ids via draft-assignment overlap scoring."""
    if not legacy_ids or not stable_ids:
        return {}

    if len(legacy_ids) == len(stable_ids) and len(legacy_ids) <= 4:
        import itertools

        best: Dict[str, str] = {}
        best_score = 0
        for perm in itertools.permutations(stable_ids):
            mapping = {legacy_ids[i]: perm[i] for i in range(len(legacy_ids))}
            total = sum(
                _legacy_stable_overlap_score(
                    leg, stab, replay, draft_names, teams_by_id, preds_by_legacy
                )
                for leg, stab in mapping.items()
            )
            if total > best_score:
                best_score = total
                best = mapping
        if best:
            return best

    ranked: List[tuple] = []
    for leg in legacy_ids:
        for stab in stable_ids:
            ranked.append(
                (
                    _legacy_stable_overlap_score(
                        leg, stab, replay, draft_names, teams_by_id, preds_by_legacy
                    ),
                    leg,
                    stab,
                )
            )
    ranked.sort(key=lambda x: x[0], reverse=True)

    used_legacy: set = set()
    used_stable: set = set()
    out: Dict[str, str] = {}
    for pts, leg, stab in ranked:
        if pts <= 0 or leg in used_legacy or stab in used_stable:
            continue
        out[leg] = stab
        used_legacy.add(leg)
        used_stable.add(stab)
    return out


async def _infer_legacy_from_single_draft_team_in_group(
    db, existing: Dict[str, str],
) -> Dict[str, str]:
    """When a user has only one drafted nation in a group, map their legacy pick to it."""
    teams_by_id = await _teams_by_id(db)
    stable_order = _seed_file_team_ids_in_order()
    replay = await _replay_draft_assignments(db, stable_order) or {}
    out: Dict[str, str] = {}
    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "value.team_id": {"$exists": True}},
        {"_id": 0, "user_id": 1, "target_id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if not _is_legacy_team_id(tid):
            continue
        s = str(tid)
        if s in existing or s in out:
            continue
        gid = (p.get("target_id") or "").upper()
        uid = p.get("user_id")
        if not uid or gid not in GROUP_IDS:
            continue
        assigned = replay.get(uid) or []
        in_group = [
            x for x in assigned
            if (teams_by_id.get(x) or {}).get("group_id") == gid
        ]
        if len(in_group) != 1:
            continue
        candidate = in_group[0]
        if teams_by_id.get(candidate):
            out[s] = candidate
    return out


async def _infer_remaining_legacy_in_groups(db, existing: Dict[str, str]) -> Dict[str, str]:
    """Finish mapping legacy ids still missing after earlier passes (partial groups)."""
    teams_by_id = await _teams_by_id(db)
    stable_order = _seed_file_team_ids_in_order()
    replay = await _replay_draft_assignments(db, stable_order) or {}
    draft_names = await _draft_names_by_user(db)
    out: Dict[str, str] = {}

    for gid in GROUP_IDS:
        preds_by_legacy: Dict[str, List[str]] = {}
        mapped_stables_in_group: set = set()

        async for p in db.world_cup_predictions.find(
            {"type": PRED_GROUP_WINNER, "target_id": gid},
            {"_id": 0, "user_id": 1, "value": 1},
        ):
            val = p.get("value") or {}
            if not isinstance(val, dict):
                continue
            tid = val.get("team_id")
            if not tid:
                continue
            uid = p.get("user_id")
            if _is_legacy_team_id(tid):
                s = str(tid)
                preds_by_legacy.setdefault(s, [])
                if uid:
                    preds_by_legacy[s].append(uid)
                stab = existing.get(s) or out.get(s)
                if stab:
                    mapped_stables_in_group.add(stab)
            elif str(tid) in teams_by_id:
                mapped_stables_in_group.add(str(tid))

        unmapped = [k for k in preds_by_legacy if k not in existing and k not in out]
        if not unmapped:
            continue

        stable_in_group = [
            t["id"] for t in teams_by_id.values()
            if (t.get("group_id") or "").upper() == gid and t.get("id")
        ]
        stable_in_group.sort(key=lambda x: stable_order.index(x) if x in stable_order else 999)
        remaining_stable = [s for s in stable_in_group if s not in mapped_stables_in_group]
        if not remaining_stable:
            continue

        n = min(len(unmapped), len(remaining_stable))
        chunk_legacy = sorted(unmapped)[:n]
        chunk_stable = remaining_stable[:n]

        mapping = _greedy_legacy_stable_match(
            chunk_legacy,
            chunk_stable,
            replay,
            draft_names,
            teams_by_id,
            preds_by_legacy,
        )
        if not mapping and len(chunk_legacy) == len(chunk_stable) and len(chunk_legacy) <= 4:
            import itertools

            best: Dict[str, str] = {}
            best_score = 0
            for perm in itertools.permutations(chunk_stable):
                candidate = {chunk_legacy[i]: perm[i] for i in range(len(chunk_legacy))}
                total = sum(
                    _legacy_stable_overlap_score(
                        leg, stab, replay, draft_names, teams_by_id, preds_by_legacy
                    )
                    for leg, stab in candidate.items()
                )
                if total > best_score:
                    best_score = total
                    best = candidate
            if best_score > 0:
                mapping = best

        out.update(mapping)

    return out


async def _infer_legacy_to_stable_from_draft_overlap(db) -> Dict[str, str]:
    """
    Guess legacy UUID → stable id when entries were already remapped.
    Uses group-winner picks + draft replay + inbox notification names.
    """
    stable_order = _seed_file_team_ids_in_order()
    replay = await _replay_draft_assignments(db, stable_order)
    if not replay:
        return {}

    teams_by_id = await _teams_by_id(db)
    draft_names = await _draft_names_by_user(db)
    mapping: Dict[str, str] = {}

    for gid in GROUP_IDS:
        legacy_ids = list((await _users_by_legacy_group_pick(db, gid)).keys())
        if not legacy_ids:
            continue
        stable_ids = [
            t["id"]
            for t in teams_by_id.values()
            if (t.get("group_id") or "").upper() == gid and t.get("id")
        ]
        stable_ids.sort(key=lambda s: stable_order.index(s) if s in stable_order else 999)
        preds_by_legacy = await _users_by_legacy_group_pick(db, gid)
        mapping.update(
            _greedy_legacy_stable_match(
                legacy_ids, stable_ids, replay, draft_names, teams_by_id, preds_by_legacy
            )
        )

    # Tournament 2nd/3rd picks — match globally against draft overlap
    global_legacy: set = set()
    global_users: Dict[str, List[str]] = {}
    async for p in db.world_cup_predictions.find(
        {"type": {"$in": [PRED_SECOND_PLACE, PRED_THIRD_PLACE]}, "value.team_id": {"$exists": True}},
        {"_id": 0, "user_id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if not _is_legacy_team_id(tid):
            continue
        s = str(tid)
        global_legacy.add(s)
        uid = p.get("user_id")
        if uid:
            global_users.setdefault(s, []).append(uid)

    if global_legacy:
        all_stable = [t["id"] for t in teams_by_id.values() if t.get("id")]
        mapping.update(
            _greedy_legacy_stable_match(
                list(global_legacy),
                all_stable,
                replay,
                draft_names,
                teams_by_id,
                global_users,
            )
        )

    return mapping


async def _score_legacy_draft_order(
    legacy_order: List[str],
    stable_order: List[str],
    draft_seed: int,
    entries: list,
    real_entries: list,
    draft_names: Dict[str, List[str]],
    teams_by_id: dict,
) -> int:
    if len(legacy_order) != len(stable_order) or not legacy_order:
        return 0
    legacy_to_stable = {str(legacy_order[i]): stable_order[i] for i in range(len(legacy_order))}
    rng = random.Random(int(draft_seed))
    shuffled = list(legacy_order)
    rng.shuffle(shuffled)
    n_all = len(entries)
    n_real = len(real_entries)
    assignments: Dict[str, List[str]] = {e["user_id"]: [] for e in entries}
    for i, tid in enumerate(shuffled):
        uid = real_entries[i % n_real]["user_id"]
        assignments[uid].append(tid)
    for i, entry in enumerate(entries):
        if not entry.get("ghost_entry"):
            continue
        uid = entry["user_id"]
        assignments[uid] = [shuffled[j] for j in range(i, len(shuffled), n_all)]
    score = 0
    for uid, legacy_tids in assignments.items():
        names = draft_names.get(uid) or []
        for i, lid in enumerate(legacy_tids):
            if i >= len(names):
                break
            sid = legacy_to_stable.get(str(lid))
            team = teams_by_id.get(sid) or {}
            if _norm_name(team.get("name")) == _norm_name(names[i]):
                score += 1
    return score


async def _infer_legacy_to_stable_from_notification_order(db) -> Dict[str, str]:
    """
    Reconstruct legacy UUID order by hill-climbing against draft inbox names.
    Works when draft_source_team_ids was never saved but notifications still exist.
    """
    cfg = await _load_config(db)
    if not cfg.get("draft_run") or cfg.get("draft_seed") is None:
        return {}

    stable_order = _seed_file_team_ids_in_order()
    teams_by_id = await _teams_by_id(db)
    draft_names = await _draft_names_by_user(db)
    if not draft_names:
        return {}

    legacy_by_group: Dict[str, List[str]] = {}
    known_legacy: set = set()

    def note_legacy(tid: Any, gid: Optional[str] = None) -> None:
        if not _is_legacy_team_id(tid):
            return
        s = str(tid)
        known_legacy.add(s)
        if gid and gid in GROUP_IDS:
            legacy_by_group.setdefault(gid, [])
            if s not in legacy_by_group[gid]:
                legacy_by_group[gid].append(s)

    async for entry in db.world_cup_entries.find({}, {"_id": 0, "drafted_team_ids": 1}):
        for tid in entry.get("drafted_team_ids") or []:
            team = teams_by_id.get(tid) or {}
            note_legacy(tid, (team.get("group_id") or "").upper() or None)

    async for m in db.world_cup_matches.find({}, {"_id": 0, "group_id": 1, "home_team_id": 1, "away_team_id": 1}):
        gid = (m.get("group_id") or "").upper()
        note_legacy(m.get("home_team_id"), gid or None)
        note_legacy(m.get("away_team_id"), gid or None)

    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "type": 1, "target_id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if p.get("type") == PRED_GROUP_WINNER:
            note_legacy(tid, (p.get("target_id") or "").upper())
        else:
            note_legacy(tid)

    # If group buckets are incomplete, bucket unknown legacy ids by prediction usage
    for s in known_legacy:
        placed = any(s in (legacy_by_group.get(g) or []) for g in GROUP_IDS)
        if placed:
            continue
        async for p in db.world_cup_predictions.find(
            {"type": PRED_GROUP_WINNER, "value.team_id": s},
            {"_id": 0, "target_id": 1},
        ).limit(1):
            gid = (p.get("target_id") or "").upper()
            if gid in GROUP_IDS:
                note_legacy(s, gid)

    entries = await db.world_cup_entries.find(
        {}, {"_id": 0, "user_id": 1, "ghost_entry": 1},
    ).to_list(5000)
    real_entries = [e for e in entries if not e.get("ghost_entry")]
    if not real_entries:
        return {}

    group_legacy_slots: Dict[str, List[str]] = {
        gid: sorted(legacy_by_group.get(gid) or []) for gid in GROUP_IDS
    }

    def build_order(slots: Dict[str, List[str]]) -> List[str]:
        out: List[str] = []
        for gid in GROUP_IDS:
            stab_group = [
                s for s in stable_order
                if (teams_by_id.get(s) or {}).get("group_id") == gid
            ]
            legs = list(slots.get(gid) or [])
            if len(legs) != len(stab_group):
                return []
            out.extend(legs)
        return out

    slots = {g: list(v) for g, v in group_legacy_slots.items()}
    legacy_order = build_order(slots)
    if len(legacy_order) != len(stable_order):
        return {}

    seed = int(cfg["draft_seed"])
    best_score = await _score_legacy_draft_order(
        legacy_order, stable_order, seed, entries, real_entries, draft_names, teams_by_id
    )
    best_slots = {g: list(v) for g, v in slots.items()}

    for _ in range(3000):
        gid = random.choice(list(GROUP_IDS))
        legs = slots.get(gid) or []
        if len(legs) < 2:
            continue
        i, j = random.sample(range(len(legs)), 2)
        legs[i], legs[j] = legs[j], legs[i]
        candidate_order = build_order(slots)
        if len(candidate_order) != len(stable_order):
            continue
        sc = await _score_legacy_draft_order(
            candidate_order, stable_order, seed, entries, real_entries, draft_names, teams_by_id
        )
        if sc > best_score:
            best_score = sc
            best_slots = {g: list(slots[g]) for g in slots}
            legacy_order = candidate_order
        else:
            slots[gid][i], slots[gid][j] = slots[gid][j], slots[gid][i]

    if best_score <= 0:
        return {}

    final_order = build_order(best_slots)
    out: Dict[str, str] = {}
    for i, leg in enumerate(final_order):
        if _is_legacy_team_id(leg):
            out[str(leg)] = stable_order[i]
    return out


async def _draft_names_by_user(db) -> Dict[str, List[str]]:
    by_user: Dict[str, List[str]] = {}
    async for n in db.notifications.find(
        {"category": "world_cup", "message": {"$regex": "Team draft complete"}},
        {"_id": 0, "user_id": 1, "message": 1},
    ):
        msg = n.get("message") or ""
        m = _DRAFT_NOTIFY_RE.search(msg)
        if not m:
            continue
        names_part = re.sub(r"\s*\(\+\d+ more\)\s*$", "", m.group(2)).strip()
        names = [x.strip() for x in names_part.split(",") if x.strip()]
        uid = n.get("user_id")
        if uid and names:
            by_user[uid] = names
    return by_user


def _is_legacy_team_id(tid: Any) -> bool:
    if not tid:
        return False
    return not str(tid).startswith("wc26-")


async def _wc_upsert_group_pick_snapshot(
    db,
    user_id: str,
    group_id: str,
    value: dict,
    *,
    source: str = "save",
) -> bool:
    """Keep the first recorded group-winner pick per user/group (survives bad remaps)."""
    gid = (group_id or "").strip().upper()
    uid = (user_id or "").strip()
    if not uid or gid not in GROUP_IDS:
        return False
    val = value if isinstance(value, dict) else {}
    tid = val.get("team_id")
    if not tid:
        return False
    existing = await db[WC_PICK_SNAPSHOT_COL].find_one(
        {"user_id": uid, "group_id": gid},
        {"_id": 0, "id": 1},
    )
    if existing:
        return False
    await db[WC_PICK_SNAPSHOT_COL].insert_one({
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "group_id": gid,
        "team_id": tid,
        "team_name": (val.get("team_name") or "").strip() or None,
        "short_code": (val.get("short_code") or "").strip().upper() or None,
        "original_team_id": val.get("original_team_id") or tid,
        "source": source,
        "captured_at": _now_iso(),
    })
    return True


async def _wc_snapshot_all_group_picks(db, *, source: str = "pre_repair") -> int:
    teams_by_id = await _teams_by_id(db)
    count = 0
    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "value.team_id": {"$exists": True}},
        {"_id": 0, "user_id": 1, "target_id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        name = (val.get("team_name") or "").strip()
        orig = val.get("original_team_id")
        # Skip likely-wrong stable ids with no name anchor (would freeze bad repair output).
        if not _is_legacy_team_id(tid) and not _is_legacy_team_id(orig) and not name:
            continue
        if name and tid and not _is_legacy_team_id(tid):
            team = teams_by_id.get(str(tid)) or {}
            if team and _norm_name(team.get("name")) == _norm_name(name):
                pass
            elif team and _norm_name(team.get("name")) != _norm_name(name):
                pass  # mismatched name — snapshot the stored name as ground truth
        if await _wc_upsert_group_pick_snapshot(
            db, p.get("user_id") or "", p.get("target_id") or "", val, source=source,
        ):
            count += 1
    return count


async def _build_high_confidence_old_team_map(db) -> Dict[str, str]:
    """Legacy→stable map from draft snapshot and verified notification replay only."""
    name_index = await _build_team_name_index(db)
    old_to_new: Dict[str, str] = {}

    for old_id, name in (await _collect_old_team_id_to_name(db)).items():
        new_id = name_index.get(_norm_name(name))
        if new_id:
            old_to_new[str(old_id)] = new_id

    for old_id, new_id in (await _legacy_to_stable_from_draft_snapshot(db)).items():
        old_to_new[str(old_id)] = str(new_id)

    for old_id, new_id in (await _infer_legacy_to_stable_from_notification_order(db)).items():
        old_to_new.setdefault(str(old_id), str(new_id))

    cfg = await _load_config(db)
    for old_id, new_id in (cfg.get("legacy_team_id_map") or {}).items():
        if old_id and new_id:
            old_to_new[str(old_id)] = str(new_id)

    return old_to_new


async def _collect_group_picks_from_backup_collection(db) -> Dict[str, Dict[str, str]]:
    """user_id → {group_id: team_name} from world_cup_predictions_backup if present."""
    names = await db.list_collection_names()
    if "world_cup_predictions_backup" not in names:
        return {}
    teams_by_id = await _teams_by_id(db)
    high_map = await _build_high_confidence_old_team_map(db)
    by_user: Dict[str, Dict[str, str]] = {}

    async for p in db.world_cup_predictions_backup.find(
        {"type": PRED_GROUP_WINNER, "value.team_id": {"$exists": True}},
        {"_id": 0, "user_id": 1, "target_id": 1, "value": 1},
    ):
        uid = p.get("user_id") or ""
        gid = (p.get("target_id") or "").upper()
        val = p.get("value") or {}
        if not uid or gid not in GROUP_IDS or not isinstance(val, dict):
            continue
        name = (val.get("team_name") or "").strip()
        tid = val.get("team_id")
        if not name and tid:
            resolved = high_map.get(str(tid), tid)
            team = teams_by_id.get(str(resolved)) or {}
            name = (team.get("name") or "").strip()
        if name:
            by_user.setdefault(uid, {})[gid] = name
    return by_user


async def _collect_group_picks_from_messages(db) -> Dict[str, Dict[str, str]]:
    """user_id → {group_id: team_name} from game chat and inbox messages."""
    by_user: Dict[str, Dict[str, str]] = {}

    def absorb(user_id: str, text: str) -> None:
        if not user_id or not text:
            return
        parsed = _parse_group_picks_text(text)
        if not parsed:
            return
        by_user.setdefault(user_id, {}).update(parsed)

    async for msg in db.game_chat_messages.find(
        {"message": {"$regex": r"Group\s+[A-L]\s*:", "$options": "i"}},
        {"_id": 0, "user_id": 1, "message": 1},
    ).sort("created_at", 1):
        absorb(msg.get("user_id") or "", msg.get("message") or "")

    async for n in db.notifications.find(
        {"message": {"$regex": r"Group\s+[A-L]\s*:", "$options": "i"}},
        {"_id": 0, "user_id": 1, "message": 1},
    ).sort("created_at", 1):
        absorb(n.get("user_id") or "", n.get("message") or "")

    return by_user


async def _build_comprehensive_old_team_map(db) -> Dict[str, str]:
    """Map legacy team UUIDs to stable wc26-{code} ids."""
    teams_by_id = await _teams_by_id(db)
    name_index = await _build_team_name_index(db)
    name_map: Dict[str, str] = {}

    for old_id, name in (await _collect_old_team_id_to_name(db)).items():
        if name:
            name_map[old_id] = name

    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "value": 1, "type": 1, "target_id": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if not _is_legacy_team_id(tid):
            continue
        stored = (val.get("team_name") or val.get("name") or "").strip()
        if stored:
            name_map.setdefault(str(tid), stored)

    for m in await db.world_cup_matches.find({}, {"_id": 0}).to_list(500):
        from utils.world_cup_fixtures import team_briefs_from_official_schedule

        sh, sa = team_briefs_from_official_schedule(m, teams_by_id)
        for field, brief in (("home_team_id", sh), ("away_team_id", sa)):
            tid = m.get(field)
            if _is_legacy_team_id(tid) and brief and brief.get("name"):
                name_map.setdefault(str(tid), brief["name"])

    for gid in GROUP_IDS:
        while True:
            group_teams = [
                t for t in teams_by_id.values()
                if (t.get("group_id") or "").upper() == gid
            ]
            group_orphans: set = set()
            async for p in db.world_cup_predictions.find(
                {"type": PRED_GROUP_WINNER, "target_id": gid},
                {"_id": 0, "value": 1},
            ):
                val = p.get("value") or {}
                if not isinstance(val, dict):
                    continue
                tid = val.get("team_id")
                if _is_legacy_team_id(tid):
                    group_orphans.add(str(tid))
            assigned_names = {_norm_name(name_map[o]) for o in group_orphans if o in name_map}
            unmapped = {o for o in group_orphans if o not in name_map}
            remaining = [
                t for t in group_teams
                if _norm_name(t.get("name") or "") not in assigned_names
            ]
            if len(unmapped) == 1 and len(remaining) == 1:
                name_map[list(unmapped)[0]] = remaining[0].get("name") or ""
            else:
                break

    stable_id_set = set(_seed_file_team_ids_in_order())
    old_to_new: Dict[str, str] = {}
    for old_id, name in name_map.items():
        new_id = name_index.get(_norm_name(name))
        if new_id:
            old_to_new[old_id] = new_id
    await _expand_old_to_new_from_predictions(db, old_to_new, teams_by_id, stable_id_set)

    for old_id, new_id in (await _legacy_to_stable_from_draft_snapshot(db)).items():
        old_to_new.setdefault(old_id, new_id)
    for old_id, new_id in (await _infer_legacy_to_stable_from_draft_overlap(db)).items():
        old_to_new.setdefault(old_id, new_id)
    for old_id, new_id in (await _infer_legacy_to_stable_from_notification_order(db)).items():
        old_to_new.setdefault(old_id, new_id)
    for old_id, new_id in (await _infer_legacy_from_single_draft_team_in_group(db, old_to_new)).items():
        old_to_new.setdefault(old_id, new_id)
    for old_id, new_id in (await _infer_remaining_legacy_in_groups(db, old_to_new)).items():
        old_to_new.setdefault(old_id, new_id)
    cfg = await _load_config(db)
    for old_id, new_id in (cfg.get("legacy_team_id_map") or {}).items():
        if old_id and new_id:
            old_to_new[str(old_id)] = str(new_id)

    return old_to_new


async def _apply_orphan_team_id_map(db, old_to_new: Dict[str, str]) -> dict:
    """Rewrite legacy UUID references in predictions, entries, and groups."""
    teams_by_id = await _teams_by_id(db)
    preds_updated = 0
    entries_updated = 0
    groups_updated = 0

    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "id": 1, "value": 1, "user_id": 1, "type": 1, "target_id": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        old_tid = val.get("team_id")
        new_tid = old_to_new.get(str(old_tid), old_tid)
        if new_tid == old_tid and not _is_legacy_team_id(old_tid):
            continue
        if new_tid == old_tid:
            continue
        if p.get("type") == PRED_GROUP_WINNER and _is_legacy_team_id(old_tid):
            await _wc_upsert_group_pick_snapshot(
                db,
                p.get("user_id") or "",
                p.get("target_id") or "",
                val,
                source="pre_remap",
            )
        patch = dict(val)
        patch["team_id"] = new_tid
        if not patch.get("original_team_id"):
            patch["original_team_id"] = old_tid
        team = teams_by_id.get(new_tid) or {}
        if team.get("name") and not (patch.get("team_name") or "").strip():
            patch["team_name"] = team["name"]
        if team.get("short_code") and not (patch.get("short_code") or "").strip():
            patch["short_code"] = team["short_code"]
        await db.world_cup_predictions.update_one({"id": p["id"]}, {"$set": {"value": patch}})
        preds_updated += 1

    async for e in db.world_cup_entries.find({}, {"_id": 0, "user_id": 1, "drafted_team_ids": 1}):
        old_tids = e.get("drafted_team_ids") or []
        new_tids = [old_to_new.get(str(t), t) for t in old_tids]
        if new_tids != old_tids:
            await db.world_cup_entries.update_one(
                {"user_id": e["user_id"]},
                {"$set": {"drafted_team_ids": new_tids}},
            )
            entries_updated += 1

    async for g in db.world_cup_groups.find({}, {"_id": 0, "group_id": 1, "winner_team_id": 1}):
        wid = g.get("winner_team_id")
        if not wid or not _is_legacy_team_id(wid):
            continue
        new_wid = old_to_new.get(str(wid))
        if new_wid and new_wid != wid:
            await db.world_cup_groups.update_one(
                {"group_id": g["group_id"]},
                {"$set": {"winner_team_id": new_wid}},
            )
            groups_updated += 1

    return {
        "predictions_remapped": preds_updated,
        "entries_remapped": entries_updated,
        "groups_remapped": groups_updated,
        "mapping_size": len(old_to_new),
    }


async def _ensure_orphan_team_ids_healed(db) -> Optional[dict]:
    """Auto-fix legacy team UUIDs still referenced in predictions."""
    legacy = False
    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "value.team_id": 1},
    ).limit(5000):
        if _is_legacy_team_id((p.get("value") or {}).get("team_id")):
            legacy = True
            break
    if not legacy:
        return None
    await _ensure_stable_teams_from_seed(db)
    await _repair_match_team_ids(db)
    total_remapped = 0
    last_applied: dict = {}
    old_to_new: Dict[str, str] = {}
    for _ in range(3):
        old_to_new = await _build_high_confidence_old_team_map(db)
        last_applied = await _apply_orphan_team_id_map(db, old_to_new)
        total_remapped += int(last_applied.get("predictions_remapped") or 0)
        if not last_applied.get("predictions_remapped"):
            break
    named = await _backfill_prediction_team_fields(db, old_to_new)
    last_applied["predictions_remapped"] = total_remapped
    last_applied["predictions_named"] = named
    return last_applied


async def _replay_draft_assignments(db, team_ids: List[str]) -> Optional[Dict[str, List[str]]]:
    """Rebuild draft assignments from stored draft_seed (same algorithm as _run_draft_internal)."""
    cfg = await _load_config(db)
    if not cfg.get("draft_run") or cfg.get("draft_seed") is None:
        return None
    if not team_ids:
        return None
    seed = int(cfg["draft_seed"])
    entries = await db.world_cup_entries.find(
        {},
        {"_id": 0, "user_id": 1, "ghost_entry": 1, "entered_at": 1},
    ).sort([("entered_at", 1), ("user_id", 1)]).to_list(5000)
    if not entries:
        return None
    real_entries = [e for e in entries if not e.get("ghost_entry")]
    if not real_entries:
        return None
    rng = random.Random(seed)
    shuffled = list(team_ids)
    rng.shuffle(shuffled)
    n_all = len(entries)
    n_real = len(real_entries)
    assignments: Dict[str, List[str]] = {e["user_id"]: [] for e in entries}
    for i, tid in enumerate(shuffled):
        uid = real_entries[i % n_real]["user_id"]
        assignments[uid].append(tid)
    for i, entry in enumerate(entries):
        if not entry.get("ghost_entry"):
            continue
        uid = entry["user_id"]
        assignments[uid] = [shuffled[j] for j in range(i, len(shuffled), n_all)]
    return assignments


async def _build_team_name_index(db) -> Dict[str, str]:
    index: Dict[str, str] = {}
    async for t in db.world_cup_teams.find({}, {"_id": 0, "id": 1, "name": 1, "odds_api_names": 1}):
        tid = t.get("id")
        if not tid:
            continue
        index[_norm_name(t.get("name"))] = tid
        for alias in t.get("odds_api_names") or []:
            index[_norm_name(alias)] = tid
    return index


async def _ensure_stable_teams_from_seed(db) -> dict:
    """Upsert FIFA teams with stable wc26-{short_code} ids (no wipe)."""
    data = _load_seed_teams_data()
    teams_upserted = 0
    groups_upserted = 0
    for grp in data.get("groups") or []:
        gid = (grp.get("group_id") or "").strip().upper()
        team_ids: List[str] = []
        for t in grp.get("teams") or []:
            sc = (t.get("short_code") or "").strip().upper()
            if not sc:
                continue
            tid = _stable_wc_team_id(sc)
            doc = {
                "id": tid,
                "name": t.get("name"),
                "short_code": sc,
                "flag_emoji": t.get("flag_emoji") or "",
                "group_id": gid,
                "odds_api_names": t.get("odds_api_names") or [],
            }
            await db.world_cup_teams.update_one({"id": tid}, {"$set": doc}, upsert=True)
            team_ids.append(tid)
            teams_upserted += 1
        existing = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1, "settled_at": 1})
        patch = {"group_id": gid, "team_ids": team_ids}
        if existing and existing.get("winner_team_id"):
            patch["winner_team_id"] = existing["winner_team_id"]
            if existing.get("settled_at"):
                patch["settled_at"] = existing["settled_at"]
        else:
            cfg = await _load_config(db)
            code = (cfg.get("official_group_winners") or {}).get(gid)
            if code:
                tid = await _winner_id_from_short_code(str(code), await _teams_by_id(db))
                if tid:
                    patch["winner_team_id"] = tid
        await db.world_cup_groups.update_one({"group_id": gid}, {"$set": patch}, upsert=True)
        groups_upserted += 1
    stable_ids = set(_seed_file_team_ids_in_order(data))
    if stable_ids:
        await db.world_cup_teams.delete_many({"id": {"$nin": list(stable_ids)}})
    return {"teams_upserted": teams_upserted, "groups_upserted": groups_upserted}


async def _remap_team_id_field(old_id: Any, old_to_new: Dict[str, str], stable_ids: set) -> Any:
    if not old_id:
        return old_id
    s = str(old_id)
    if s in stable_ids:
        return s
    return old_to_new.get(s, s)


async def _team_id_to_short_code(db, team_id: str, teams_by_id: Optional[dict] = None) -> Optional[str]:
    teams = teams_by_id if teams_by_id is not None else await _teams_by_id(db)
    team = teams.get(team_id) or await db.world_cup_teams.find_one({"id": team_id}, {"_id": 0, "short_code": 1})
    sc = (team or {}).get("short_code") or ""
    sc = sc.strip().upper()
    return sc or None


async def _persist_official_group_winner(db, group_id: str, winner_team_id: str) -> None:
    """Survives team re-seeds — stored on game_config by short code."""
    gid = (group_id or "").strip().upper()
    if gid not in GROUP_IDS or not winner_team_id:
        return
    sc = await _team_id_to_short_code(db, winner_team_id)
    if not sc:
        return
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {f"official_group_winners.{gid}": sc}},
        upsert=True,
    )


async def _winner_id_from_short_code(short_code: str, teams_by_id: dict) -> Optional[str]:
    sc = (short_code or "").strip().upper()
    if not sc:
        return None
    tid = _stable_wc_team_id(sc)
    if teams_by_id.get(tid):
        return tid
    for t in teams_by_id.values():
        if (t.get("short_code") or "").strip().upper() == sc:
            return t.get("id")
    return tid if sc else None


async def _expand_old_to_new_from_predictions(
    db,
    old_to_new: Dict[str, str],
    teams_by_id: dict,
    stable_id_set: set,
) -> int:
    """Map legacy UUID picks using group winners inferred from standings."""
    added = 0
    for gid in GROUP_IDS:
        gteams = [t["id"] for t in teams_by_id.values() if (t.get("group_id") or "").upper() == gid]
        if len(gteams) < 2:
            continue
        matches = await db.world_cup_matches.find(
            {"group_id": gid, "stage": "group", "status": "settled"},
            {"_id": 0},
        ).to_list(20)
        expected = len(gteams) * (len(gteams) - 1) // 2
        if len(matches) < expected:
            continue
        ranked = _compute_group_standings(gteams, matches)
        if not ranked:
            continue
        winner_stable = ranked[0]
        async for pred in db.world_cup_predictions.find(
            {
                "type": PRED_GROUP_WINNER,
                "target_id": gid,
                "settled": True,
                "points_awarded": {"$gt": 0},
            },
            {"_id": 0, "value": 1},
        ):
            val = pred.get("value") or {}
            raw = val.get("team_id") if isinstance(val, dict) else val
            if not raw:
                continue
            s = str(raw)
            if s in stable_id_set or s in old_to_new:
                continue
            old_to_new[s] = winner_stable
            added += 1
            break
    return added


async def _restore_group_winners(
    db,
    old_to_new: Dict[str, str],
    stable_id_set: set,
) -> dict:
    """Restore official group winners from config backup, predictions, and standings."""
    teams_by_id = await _teams_by_id(db)
    cfg = await _load_config(db)
    restored_config = 0
    restored_preds = 0
    restored_standings = 0
    persisted = 0

    # 1. Config backup (short codes survive re-seed)
    for gid in GROUP_IDS:
        grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
        if grp and teams_by_id.get(grp.get("winner_team_id")):
            continue
        code = (cfg.get("official_group_winners") or {}).get(gid)
        if not code:
            continue
        tid = await _winner_id_from_short_code(str(code), teams_by_id)
        if not tid:
            continue
        await db.world_cup_groups.update_one(
            {"group_id": gid},
            {"$set": {"winner_team_id": tid, "settled_at": (grp or {}).get("settled_at") or _now_iso()}},
            upsert=True,
        )
        restored_config += 1

    teams_by_id = await _teams_by_id(db)

    # 2. Settled predictions — actual_winner field or correct picks
    for gid in GROUP_IDS:
        grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
        if grp and teams_by_id.get(grp.get("winner_team_id")):
            continue
        winner_tid = None
        async for pred in db.world_cup_predictions.find(
            {"type": PRED_GROUP_WINNER, "target_id": gid, "settled": True},
            {"_id": 0, "value": 1, "points_awarded": 1, "actual_winner_team_id": 1},
        ):
            aw = pred.get("actual_winner_team_id")
            if aw:
                candidate = str(await _remap_team_id_field(aw, old_to_new, stable_id_set))
                if teams_by_id.get(candidate):
                    winner_tid = candidate
                    break
            if int(pred.get("points_awarded") or 0) > 0:
                val = pred.get("value") or {}
                raw = val.get("team_id") if isinstance(val, dict) else val
                candidate = str(await _remap_team_id_field(raw, old_to_new, stable_id_set))
                if teams_by_id.get(candidate):
                    winner_tid = candidate
                    break
        if winner_tid:
            await db.world_cup_groups.update_one(
                {"group_id": gid},
                {"$set": {"winner_team_id": winner_tid, "settled_at": (grp or {}).get("settled_at") or _now_iso()}},
                upsert=True,
            )
            await _persist_official_group_winner(db, gid, winner_tid)
            restored_preds += 1

    teams_by_id = await _teams_by_id(db)

    # 3. Standings (after match team ids are fixed)
    for gid in GROUP_IDS:
        grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0})
        if grp and teams_by_id.get(grp.get("winner_team_id")):
            continue
        gteams = grp.get("team_ids") if grp else []
        if not gteams:
            gteams = [t["id"] for t in teams_by_id.values() if (t.get("group_id") or "").upper() == gid]
        matches = await db.world_cup_matches.find(
            {"group_id": gid, "stage": "group", "status": "settled"},
            {"_id": 0},
        ).to_list(20)
        expected = (len(gteams) * (len(gteams) - 1)) // 2 if len(gteams) >= 2 else 0
        has_settled_preds = await db.world_cup_predictions.count_documents(
            {"type": PRED_GROUP_WINNER, "target_id": gid, "settled": True}
        ) > 0
        min_matches = expected if not has_settled_preds else max(1, min(3, expected))
        if len(matches) < min_matches or expected <= 0:
            continue
        if not all(
            teams_by_id.get(m.get("home_team_id")) and teams_by_id.get(m.get("away_team_id"))
            for m in matches
        ):
            continue
        ranked = _compute_group_standings(gteams, matches)
        if not ranked or not teams_by_id.get(ranked[0]):
            continue
        await db.world_cup_groups.update_one(
            {"group_id": gid},
            {"$set": {"winner_team_id": ranked[0], "settled_at": (grp or {}).get("settled_at") or _now_iso()}},
            upsert=True,
        )
        await _persist_official_group_winner(db, gid, ranked[0])
        restored_standings += 1

    # Backfill actual_winner on settled preds + persist config for anything we restored
    async for g in db.world_cup_groups.find({"winner_team_id": {"$exists": True, "$ne": None}}, {"_id": 0}):
        gid = g.get("group_id")
        wid = g.get("winner_team_id")
        if not gid or not wid or not teams_by_id.get(wid):
            continue
        await db.world_cup_predictions.update_many(
            {"type": PRED_GROUP_WINNER, "target_id": gid, "settled": True},
            {"$set": {"actual_winner_team_id": wid}},
        )
        await _persist_official_group_winner(db, gid, wid)
        persisted += 1

    return {
        "group_winners_from_config": restored_config,
        "group_winners_from_predictions": restored_preds,
        "group_winners_from_standings": restored_standings,
        "group_winners_persisted": persisted,
        "group_winners_restored": restored_config + restored_preds + restored_standings,
    }


async def _repair_match_team_ids(db) -> dict:
    """Fix orphaned home_team_id / away_team_id on matches (scores unchanged)."""
    from utils.world_cup_fixtures import (
        canonical_wc_team_name,
        lookup_official_fixtures_for_match_row,
        normalize_wc_kickoff_utc,
    )

    teams_by_id = await _teams_by_id(db)

    def team_broken(tid: Any) -> bool:
        if not tid:
            return True
        return str(tid) not in teams_by_id

    updated_odds = 0
    try:
        events = await sb._fetch_odds_api_h2h_events_merged(WC_SPORT_KEY)
        by_ext = {(ev.get("id") or "").strip(): ev for ev in events or [] if (ev.get("id") or "").strip()}
        async for m in db.world_cup_matches.find(
            {"external_event_id": {"$exists": True, "$nin": ["", None]}},
            {"_id": 0},
        ):
            if not team_broken(m.get("home_team_id")) and not team_broken(m.get("away_team_id")):
                continue
            ev = by_ext.get((m.get("external_event_id") or "").strip())
            if not ev:
                continue
            home_id = await _resolve_team_id(db, ev.get("home_team") or "", teams_by_id)
            away_id = await _resolve_team_id(db, ev.get("away_team") or "", teams_by_id)
            if not home_id or not away_id:
                continue
            await db.world_cup_matches.update_one(
                {"id": m["id"]},
                {"$set": {"home_team_id": home_id, "away_team_id": away_id}},
            )
            teams_by_id[home_id] = teams_by_id.get(home_id) or await db.world_cup_teams.find_one({"id": home_id}, {"_id": 0})
            teams_by_id[away_id] = teams_by_id.get(away_id) or await db.world_cup_teams.find_one({"id": away_id}, {"_id": 0})
            updated_odds += 1
    except Exception as ex:
        logger.warning("wc repair match ids from odds failed: %s", ex)

    updated_schedule = 0
    assigned_by_slot: Dict[tuple, set] = {}
    async for m in db.world_cup_matches.find({}, {"_id": 0}):
        if not team_broken(m.get("home_team_id")) and not team_broken(m.get("away_team_id")):
            continue
        candidates = lookup_official_fixtures_for_match_row(m)
        if not candidates:
            continue
        slot_key = (
            normalize_wc_kickoff_utc(m.get("kickoff")),
            (m.get("group_id") or "").strip().upper(),
            (m.get("knockout_round") or "").strip().lower(),
        )
        used = assigned_by_slot.setdefault(slot_key, set())
        fixture = None
        for c in candidates:
            pair = (
                canonical_wc_team_name(c.get("home") or ""),
                canonical_wc_team_name(c.get("away") or ""),
            )
            if pair in used:
                continue
            fixture = c
            break
        if not fixture:
            fixture = candidates[0]
        home_id = await _resolve_team_id(db, fixture.get("home") or "", teams_by_id)
        away_id = await _resolve_team_id(db, fixture.get("away") or "", teams_by_id)
        if not home_id or not away_id:
            continue
        await db.world_cup_matches.update_one(
            {"id": m["id"]},
            {"$set": {"home_team_id": home_id, "away_team_id": away_id}},
        )
        pair = (
            canonical_wc_team_name(fixture.get("home") or ""),
            canonical_wc_team_name(fixture.get("away") or ""),
        )
        used.add(pair)
        updated_schedule += 1

    return {"matches_from_odds": updated_odds, "matches_from_schedule": updated_schedule}


async def _repair_wc_team_references(db) -> dict:
    """
    Restore drafted teams and group-winner links after a destructive re-seed.
    Uses draft_seed replay, draft notifications, and settled group-winner predictions.
    """
    seed_data = _load_seed_teams_data()
    stable_ids = _seed_file_team_ids_in_order(seed_data)
    stable_id_set = set(stable_ids)
    await _ensure_stable_teams_from_seed(db)

    # Preserve original picks before any remap (first run only fills missing snapshots)
    snapshots_captured = await _wc_snapshot_all_group_picks(db, source="pre_repair")

    # Heal legacy UUIDs in predictions/entries before anything else
    match_repair = await _repair_match_team_ids(db)
    total_remapped = 0
    old_to_new: Dict[str, str] = {}
    applied: dict = {}
    for _ in range(3):
        old_to_new = await _build_high_confidence_old_team_map(db)
        applied = await _apply_orphan_team_id_map(db, old_to_new)
        total_remapped += int(applied.get("predictions_remapped") or 0)
        if not applied.get("predictions_remapped"):
            break
    applied["predictions_remapped"] = total_remapped

    # Replay draft from stored seed when draft already ran (stable ids on entries)
    draft_restored = 0
    replay = await _replay_draft_assignments(db, stable_ids)
    if replay:
        for uid, tids in replay.items():
            res = await db.world_cup_entries.update_one(
                {"user_id": uid},
                {"$set": {"drafted_team_ids": tids}},
            )
            if res.modified_count:
                draft_restored += 1

    group_restore = await _restore_group_winners(db, old_to_new, stable_id_set)
    predictions_named = await _backfill_prediction_team_fields(db, old_to_new)
    overlap_map = await _infer_legacy_to_stable_from_draft_overlap(db)
    notification_map = await _infer_legacy_to_stable_from_notification_order(db)
    snapshot_map = await _legacy_to_stable_from_draft_snapshot(db)
    unmapped_preds = await _count_unmapped_group_winner_predictions(db, old_to_new)
    matches_updated = int(match_repair.get("matches_from_odds") or 0) + int(
        match_repair.get("matches_from_schedule") or 0
    )

    return {
        "ok": True,
        "stable_team_ids": len(stable_ids),
        "draft_entries_restored": draft_restored,
        "predictions_remapped": applied.get("predictions_remapped", 0),
        "predictions_still_unmapped": unmapped_preds,
        "entries_remapped": applied.get("entries_remapped", 0),
        "predictions_named": predictions_named,
        "snapshots_captured": snapshots_captured,
        "mapping_size": applied.get("mapping_size", 0),
        "draft_snapshot_mappings": len(snapshot_map),
        "draft_overlap_mappings": len(overlap_map),
        "draft_notification_mappings": len(notification_map),
        **group_restore,
        "matches_remapped": matches_updated,
        **match_repair,
        "draft_replay": bool(replay),
    }


async def _teams_by_id(db) -> dict:
    out = {}
    async for t in db.world_cup_teams.find({}, {"_id": 0}):
        tid = t.get("id")
        if tid:
            out[tid] = t
    return out


async def _teams_by_id_resolved(db) -> dict:
    """teams_by_id plus legacy UUID aliases and stored prediction names (admin display)."""
    await _ensure_orphan_team_ids_healed(db)
    teams = await _teams_by_id(db)
    old_to_new = await _build_comprehensive_old_team_map(db)
    for old_id, new_id in old_to_new.items():
        if new_id in teams:
            teams[old_id] = {**teams[new_id], "id": old_id}
    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "value": 1, "target_id": 1, "type": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        if not tid or tid in teams:
            continue
        name = (val.get("team_name") or val.get("name") or "").strip()
        if not name:
            continue
        teams[tid] = {
            "id": tid,
            "name": name,
            "short_code": (val.get("short_code") or "").strip(),
            "group_id": p.get("target_id") if p.get("type") == PRED_GROUP_WINNER else None,
        }
    return teams


def _prediction_team_label(val: Any, teams_by_id: dict, tid: Optional[str] = None) -> str:
    pick_id = tid
    if pick_id is None and isinstance(val, dict):
        pick_id = val.get("team_id")
    if not pick_id:
        return "?"
    team = teams_by_id.get(pick_id) or {}
    if team.get("name"):
        return str(team["name"])
    if isinstance(val, dict):
        name = (val.get("team_name") or val.get("name") or "").strip()
        if name:
            return name
        sc = (val.get("short_code") or "").strip()
        if sc:
            return sc
    return "?"


async def _backfill_prediction_team_fields(
    db, old_to_new: Optional[Dict[str, str]] = None,
) -> int:
    """Persist team_name on predictions so labels survive future re-seeds."""
    teams_by_id = await _teams_by_id(db)
    if old_to_new is None:
        old_to_new = await _build_comprehensive_old_team_map(db)
    updated = 0
    async for p in db.world_cup_predictions.find(
        {"value.team_id": {"$exists": True}},
        {"_id": 0, "id": 1, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        tid = val.get("team_id")
        resolved = old_to_new.get(str(tid), tid)
        team = teams_by_id.get(resolved) or {}
        if not team.get("name"):
            continue
        patch = dict(val)
        changed = False
        if resolved != tid:
            patch["team_id"] = resolved
            changed = True
        if patch.get("team_name") != team.get("name"):
            patch["team_name"] = team["name"]
            changed = True
        sc = (team.get("short_code") or "").strip()
        if sc and patch.get("short_code") != sc:
            patch["short_code"] = sc
            changed = True
        if changed:
            await db.world_cup_predictions.update_one({"id": p["id"]}, {"$set": {"value": patch}})
            updated += 1
    return updated


async def _count_unmapped_group_winner_predictions(db, old_to_new: Dict[str, str]) -> int:
    """Group-winner picks that still cannot resolve to a team name."""
    teams_by_id = await _teams_by_id(db)
    count = 0
    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "value.team_id": {"$exists": True}},
        {"_id": 0, "value": 1},
    ):
        val = p.get("value") or {}
        if not isinstance(val, dict):
            count += 1
            continue
        tid = val.get("team_id")
        if (val.get("team_name") or val.get("name") or "").strip():
            continue
        resolved = old_to_new.get(str(tid), tid)
        team = teams_by_id.get(resolved) or {}
        if not team.get("name"):
            count += 1
    return count


async def _resolve_team_id(db, name: str, teams_by_id: Optional[dict] = None) -> Optional[str]:
    nm = _norm_name(name)
    if not nm:
        return None
    teams = teams_by_id if teams_by_id is not None else await _teams_by_id(db)
    for t in teams.values():
        if _norm_name(t.get("name")) == nm:
            return t.get("id")
        for alias in t.get("odds_api_names") or []:
            if _norm_name(alias) == nm:
                return t.get("id")
        if sb._team_matches_option(t.get("name") or "", name):
            return t.get("id")
    return None


def _lock_at_from_kickoff(kickoff_iso: str) -> str:
    dt = _parse_iso(kickoff_iso)
    if not dt:
        return kickoff_iso
    return (dt - timedelta(minutes=LOCK_MINUTES_BEFORE)).isoformat()


async def _group_lock_times(db) -> dict:
    """Earliest kickoff per group → lock time."""
    locks = {}
    pipeline = [
        {
            "$match": {
                "stage": "group",
                "group_id": {"$in": list(GROUP_IDS)},
                "kickoff": {"$exists": True, "$nin": [None, ""]},
            }
        },
        {"$sort": {"kickoff": 1}},
        {"$group": {"_id": "$group_id", "kickoff": {"$first": "$kickoff"}}},
    ]
    async for doc in db.world_cup_matches.aggregate(pipeline):
        gid = doc.get("_id")
        kickoff = doc.get("kickoff")
        if gid and kickoff:
            locks[gid] = _lock_at_from_kickoff(kickoff)
    return locks


async def _prediction_target_counts(db, types: list) -> dict:
    counts = {}
    if not types:
        return counts
    pipeline = [
        {"$match": {"type": {"$in": types}}},
        {"$group": {"_id": "$target_id", "n": {"$sum": 1}}},
    ]
    async for doc in db.world_cup_predictions.aggregate(pipeline):
        tid = doc.get("_id")
        if tid:
            counts[tid] = int(doc["n"])
    return counts


async def _prediction_global_stats(db) -> dict:
    pipeline = [
        {
            "$facet": {
                "open": [{"$match": {"settled": {"$ne": True}}}, {"$count": "n"}],
                "won": [{"$match": {"settled": True, "points_awarded": {"$gt": 0}}}, {"$count": "n"}],
                "lost": [{"$match": {"settled": True, "points_awarded": 0}}, {"$count": "n"}],
                "pending": [{"$match": {"payout_status": "pending"}}, {"$count": "n"}],
            }
        }
    ]
    rows = await db.world_cup_predictions.aggregate(pipeline).to_list(1)
    facet = rows[0] if rows else {}
    def _fc(key):
        arr = facet.get(key) or []
        return int(arr[0]["n"]) if arr else 0
    return {
        "predictions_open": _fc("open"),
        "predictions_won": _fc("won"),
        "predictions_lost": _fc("lost"),
        "predictions_pending_payout": _fc("pending"),
    }


async def _entry_counts(db) -> dict:
    pipeline = [
        {
            "$facet": {
                "total": [{"$count": "n"}],
                "real": [{"$match": {"ghost_entry": {"$ne": True}}}, {"$count": "n"}],
                "ghost": [{"$match": {"ghost_entry": True}}, {"$count": "n"}],
            }
        }
    ]
    rows = await db.world_cup_entries.aggregate(pipeline).to_list(1)
    facet = rows[0] if rows else {}
    def _fc(key):
        arr = facet.get(key) or []
        return int(arr[0]["n"]) if arr else 0
    return {"entrants": _fc("total"), "real_entrants": _fc("real"), "ghost_entrants": _fc("ghost")}


def _is_locked(lock_iso: Optional[str]) -> bool:
    dt = _parse_iso(lock_iso)
    if not dt:
        return False
    return datetime.now(timezone.utc) >= dt


async def _settle_prediction_doc(db, send_notification, pred: dict, points: int, label: str) -> bool:
    if pred.get("settled"):
        return False
    pid = pred.get("id")
    if not pid:
        return False
    pts = int(points or 0)
    payout_status = "none"
    if pts > 0:
        uid = pred.get("user_id") or ""
        if await _is_ghost_user(db, uid):
            payout_status = "ghost"
        else:
            payout_status = "pending"
    res = await db.world_cup_predictions.update_one(
        {"id": pid, "settled": {"$ne": True}},
        {
            "$set": {
                "settled": True,
                "points_awarded": pts,
                "settled_at": _now_iso(),
                "settle_label": label,
                "payout_status": payout_status,
            }
        },
    )
    if res.modified_count > 0 and pts > 0 and payout_status == "pending":
        await _notify_wc_prediction_result(
            db,
            send_notification,
            {**pred, "settled": True, "points_awarded": pts, "settle_label": label, "payout_status": payout_status},
            pts,
            label,
            paid=False,
        )
    return res.modified_count > 0


async def _approve_prediction_payout(db, send_notification, prediction_id: str, approver_id: str) -> dict:
    pred = await db.world_cup_predictions.find_one({"id": prediction_id}, {"_id": 0})
    if not pred:
        raise HTTPException(status_code=404, detail="Prediction not found")
    if pred.get("payout_status") != "pending":
        raise HTTPException(status_code=400, detail="Prediction payout is not pending approval")
    pts = int(pred.get("points_awarded") or 0)
    uid = pred.get("user_id") or ""
    label = pred.get("settle_label") or "World Cup prediction"
    res = await db.world_cup_predictions.update_one(
        {"id": prediction_id, "payout_status": "pending"},
        {"$set": {"payout_status": "paid", "payout_approved_at": _now_iso(), "payout_approved_by": approver_id}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Payout already processed")
    if pts > 0 and uid:
        await _award_points(db, send_notification, uid, pts, prediction_id, label, pred=pred)
    return {"ok": True, "prediction_id": prediction_id, "points": pts}


async def _approve_jackpot_payout(db, send_notification, user_id: str, approver_id: str) -> dict:
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    if not entry or not entry.get("jackpot_pending"):
        raise HTTPException(status_code=400, detail="No pending jackpot for this user")
    pts = int(entry.get("jackpot_points_pending") or 0)
    champion = entry.get("jackpot_champion_team_id") or ""
    label = entry.get("jackpot_label") or "World Cup champion (draft)"
    ref = f"jackpot:{user_id}:{champion}"
    res = await db.world_cup_entries.update_one(
        {"user_id": user_id, "jackpot_pending": True},
        {
            "$set": {
                "jackpot_pending": False,
                "jackpot_awarded": True,
                "jackpot_awarded_at": _now_iso(),
                "jackpot_payout_approved_by": approver_id,
            }
        },
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Jackpot payout already processed")
    if pts > 0:
        await _award_points(db, send_notification, user_id, pts, ref, label)
    return {"ok": True, "user_id": user_id, "points": pts}


async def _approve_all_pending_payouts(db, send_notification, approver_id: str) -> dict:
    preds = await db.world_cup_predictions.find({"payout_status": "pending"}, {"_id": 0, "id": 1}).to_list(5000)
    pred_approved = 0
    pred_points = 0
    for pred in preds:
        pid = pred.get("id")
        if not pid:
            continue
        try:
            result = await _approve_prediction_payout(db, send_notification, pid, approver_id)
            pred_approved += 1
            pred_points += int(result.get("points") or 0)
        except HTTPException:
            continue
    jackpots = await db.world_cup_entries.find({"jackpot_pending": True}, {"_id": 0, "user_id": 1}).to_list(500)
    jackpot_approved = 0
    jackpot_points = 0
    for entry in jackpots:
        uid = entry.get("user_id")
        if not uid:
            continue
        try:
            result = await _approve_jackpot_payout(db, send_notification, uid, approver_id)
            jackpot_approved += 1
            jackpot_points += int(result.get("points") or 0)
        except HTTPException:
            continue
    return {
        "predictions_approved": pred_approved,
        "jackpots_approved": jackpot_approved,
        "total_points": pred_points + jackpot_points,
    }


async def _build_group_winner_payout_report(db) -> dict:
    """Preview pending group-winner payouts and summary of paid vs outstanding."""
    ghost_ids = await _ghost_user_ids(db)
    teams_by_id = await _teams_by_id_resolved(db)
    by_group: Dict[str, dict] = {
        gid: {
            "group_id": gid,
            "paid_count": 0,
            "paid_points": 0,
            "pending_count": 0,
            "pending_points": 0,
            "ghost_count": 0,
        }
        for gid in GROUP_IDS
    }
    pending_rows: List[dict] = []
    paid_rows: List[dict] = []
    paid_count = 0
    paid_points = 0
    pending_count = 0
    pending_points = 0
    ghost_count = 0
    ghost_points = 0
    paid_users: set = set()
    pending_users: set = set()
    all_user_ids: set = set()
    paid_prediction_ids: List[str] = []

    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "settled": True, "points_awarded": {"$gt": 0}},
        {"_id": 0},
    ):
        uid = p.get("user_id") or ""
        gid = (p.get("target_id") or "?").strip().upper()
        pts = int(p.get("points_awarded") or 0)
        ps = p.get("payout_status")
        grp = by_group.get(gid)
        val = p.get("value") or {}
        pick_name = _prediction_team_label(val, teams_by_id, val.get("team_id") if isinstance(val, dict) else val)
        pid = p.get("id") or ""

        if ps == "ghost" or uid in ghost_ids:
            ghost_count += 1
            ghost_points += pts
            if grp:
                grp["ghost_count"] += 1
            continue

        if uid:
            all_user_ids.add(uid)

        if ps == "pending":
            pending_count += 1
            pending_points += pts
            if uid:
                pending_users.add(uid)
            if grp:
                grp["pending_count"] += 1
                grp["pending_points"] += pts
            pending_rows.append({
                "prediction_id": pid,
                "user_id": uid,
                "group_id": gid,
                "pick": pick_name,
                "points": pts,
                "settled_at": p.get("settled_at"),
                "settle_label": p.get("settle_label") or "",
                "credit_status": "pending",
                "points_credited": False,
            })
        elif ps == "paid" or ps not in ("pending", "ghost"):
            paid_count += 1
            paid_points += pts
            if uid:
                paid_users.add(uid)
            if grp:
                grp["paid_count"] += 1
                grp["paid_points"] += pts
            if pid:
                paid_prediction_ids.append(pid)
            paid_rows.append({
                "prediction_id": pid,
                "user_id": uid,
                "group_id": gid,
                "pick": pick_name,
                "points": pts,
                "settled_at": p.get("settled_at"),
                "payout_approved_at": p.get("payout_approved_at"),
                "manual_payout_recorded": bool(p.get("manual_payout_recorded")),
                "settle_label": p.get("settle_label") or "",
                "credit_status": "unknown",
                "points_credited": False,
            })

    usernames: Dict[str, str] = {}
    if all_user_ids:
        async for u in db.users.find({"id": {"$in": list(all_user_ids)}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"

    ledger_by_ref: Dict[str, dict] = {}
    if paid_prediction_ids:
        async for ev in db.point_ledger_events.find(
            {
                "event_type": "world_cup_payout",
                "origin_ref": {"$in": paid_prediction_ids},
            },
            {"_id": 0, "origin_ref": 1, "points": 1, "created_at": 1},
        ):
            ref = ev.get("origin_ref")
            if ref:
                ledger_by_ref[str(ref)] = ev

    for row in paid_rows:
        pid = str(row.get("prediction_id") or "")
        ledger = ledger_by_ref.get(pid)
        if ledger:
            row["credit_status"] = "credited"
            row["points_credited"] = True
            row["ledger_at"] = ledger.get("created_at")
        elif row.get("manual_payout_recorded"):
            row["credit_status"] = "manual_only"
            row["points_credited"] = False
        else:
            row["credit_status"] = "paid_no_ledger"
            row["points_credited"] = False
        row["username"] = usernames.get(row.get("user_id") or "", "?")

    for row in pending_rows:
        row["username"] = usernames.get(row.get("user_id") or "", "?")

    pending_rows.sort(key=lambda r: (r.get("group_id") or "", r.get("username") or ""))
    paid_rows.sort(key=lambda r: (r.get("username") or "", r.get("group_id") or ""))

    by_player_map: Dict[str, dict] = {}
    for row in paid_rows + pending_rows:
        uid = row.get("user_id") or ""
        if not uid:
            continue
        player = by_player_map.setdefault(uid, {
            "user_id": uid,
            "username": row.get("username") or usernames.get(uid, "?"),
            "paid_points": 0,
            "pending_points": 0,
            "credited_points": 0,
            "manual_only_points": 0,
            "paid_no_ledger_points": 0,
            "pick_count": 0,
            "picks": [],
        })
        pts = int(row.get("points") or 0)
        player["pick_count"] += 1
        player["picks"].append({
            "prediction_id": row.get("prediction_id"),
            "group_id": row.get("group_id"),
            "pick": row.get("pick"),
            "points": pts,
            "credit_status": row.get("credit_status"),
            "points_credited": bool(row.get("points_credited")),
            "payout_approved_at": row.get("payout_approved_at"),
        })
        if row.get("credit_status") == "pending":
            player["pending_points"] += pts
        else:
            player["paid_points"] += pts
            if row.get("credit_status") == "credited":
                player["credited_points"] += pts
            elif row.get("credit_status") == "manual_only":
                player["manual_only_points"] += pts
            elif row.get("credit_status") == "paid_no_ledger":
                player["paid_no_ledger_points"] += pts

    by_player = sorted(
        by_player_map.values(),
        key=lambda p: (-(p.get("paid_points") or 0), -(p.get("pending_points") or 0), p.get("username") or ""),
    )
    for player in by_player:
        player["picks"].sort(key=lambda r: (r.get("group_id") or ""))

    credited_points = sum(int(r.get("points") or 0) for r in paid_rows if r.get("credit_status") == "credited")
    manual_only_points = sum(int(r.get("points") or 0) for r in paid_rows if r.get("credit_status") == "manual_only")
    paid_no_ledger_points = sum(int(r.get("points") or 0) for r in paid_rows if r.get("credit_status") == "paid_no_ledger")

    groups_out = [
        by_group[gid]
        for gid in GROUP_IDS
        if by_group[gid]["paid_count"] or by_group[gid]["pending_count"] or by_group[gid]["ghost_count"]
    ]

    summary = {
        "paid_predictions": paid_count,
        "paid_points": paid_points,
        "paid_players": len(paid_users),
        "pending_predictions": pending_count,
        "pending_points": pending_points,
        "pending_players": len(pending_users),
        "ghost_predictions": ghost_count,
        "ghost_points": ghost_points,
        "grand_total_paid": paid_points,
        "grand_total_if_remaining_paid": paid_points + pending_points,
        "credited_points": credited_points,
        "manual_only_points": manual_only_points,
        "paid_no_ledger_points": paid_no_ledger_points,
    }
    return {
        "ok": True,
        "all_paid": pending_count == 0,
        "summary": summary,
        "by_group": groups_out,
        "by_player": by_player,
        "paid": paid_rows,
        "pending": pending_rows,
    }


async def _pay_pending_group_winner_payouts(
    db,
    send_notification,
    approver_id: str,
    *,
    dry_run: bool = False,
) -> dict:
    report = await _build_group_winner_payout_report(db)
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "would_approve": report["summary"]["pending_predictions"],
            "would_pay_points": report["summary"]["pending_points"],
            "pending": report["pending"],
            "summary": report["summary"],
            "all_paid": report["all_paid"],
        }

    approved = 0
    points = 0
    failed: List[dict] = []
    for row in report["pending"]:
        pid = row.get("prediction_id")
        if not pid:
            continue
        try:
            result = await _approve_prediction_payout(db, send_notification, pid, approver_id)
            approved += 1
            points += int(result.get("points") or 0)
        except HTTPException as ex:
            failed.append({
                "prediction_id": pid,
                "username": row.get("username"),
                "group_id": row.get("group_id"),
                "error": ex.detail,
            })

    final = await _build_group_winner_payout_report(db)
    return {
        "ok": True,
        "dry_run": False,
        "predictions_approved": approved,
        "points_paid": points,
        "failed": failed,
        "summary": final["summary"],
        "all_paid": final["all_paid"],
        "by_group": final["by_group"],
    }


async def _mark_group_winner_payouts_manually_paid(
    db,
    approver_id: str,
    prediction_ids: List[str],
) -> dict:
    ids = [str(x or "").strip() for x in (prediction_ids or []) if str(x or "").strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="prediction_ids required")
    now = _now_iso()
    res = await db.world_cup_predictions.update_many(
        {
            "id": {"$in": ids},
            "type": PRED_GROUP_WINNER,
            "payout_status": "pending",
            "settled": True,
            "points_awarded": {"$gt": 0},
        },
        {
            "$set": {
                "payout_status": "paid",
                "payout_approved_at": now,
                "payout_approved_by": approver_id,
                "manual_payout_recorded": True,
                "manual_payout_recorded_at": now,
            }
        },
    )
    final = await _build_group_winner_payout_report(db)
    return {
        "ok": True,
        "marked_paid": int(res.modified_count or 0),
        "summary": final["summary"],
        "all_paid": final["all_paid"],
    }


async def _pending_payout_counts(db) -> dict:
    pending_predictions = await db.world_cup_predictions.count_documents({"payout_status": "pending"})
    pending_jackpots = await db.world_cup_entries.count_documents({"jackpot_pending": True})
    return {
        "pending_predictions": pending_predictions,
        "pending_jackpots": pending_jackpots,
        "pending_payouts": pending_predictions + pending_jackpots,
    }


async def _list_pending_payouts(db, limit: int = 100) -> dict:
    lim = max(1, min(int(limit), 500))
    preds = await db.world_cup_predictions.find(
        {"payout_status": "pending"},
        {"_id": 0},
    ).sort("settled_at", -1).limit(lim).to_list(lim)
    jackpots = await db.world_cup_entries.find(
        {"jackpot_pending": True},
        {"_id": 0},
    ).sort("jackpot_pending_at", -1).limit(lim).to_list(lim)
    user_ids = {p.get("user_id") for p in preds if p.get("user_id")}
    user_ids.update(e.get("user_id") for e in jackpots if e.get("user_id"))
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    pred_rows = []
    for p in preds:
        pred_rows.append({
            "id": p.get("id"),
            "user_id": p.get("user_id"),
            "username": usernames.get(p.get("user_id"), "?"),
            "type": p.get("type"),
            "type_label": _prediction_type_label(p.get("type") or ""),
            "target_id": p.get("target_id"),
            "points": int(p.get("points_awarded") or 0),
            "label": p.get("settle_label") or "",
            "settled_at": p.get("settled_at"),
            "payout_status": p.get("payout_status"),
        })
    jackpot_rows = []
    for e in jackpots:
        jackpot_rows.append({
            "user_id": e.get("user_id"),
            "username": usernames.get(e.get("user_id"), "?"),
            "points": int(e.get("jackpot_points_pending") or 0),
            "label": e.get("jackpot_label") or "World Cup champion (draft)",
            "pending_at": e.get("jackpot_pending_at"),
        })
    counts = await _pending_payout_counts(db)
    return {**counts, "predictions": pred_rows, "jackpots": jackpot_rows}


def _prediction_type_label(ptype: str) -> str:
    return {
        PRED_GROUP_WINNER: "Group winner",
        PRED_MATCH_SCORE: "Match score",
        PRED_MATCH_SCORER: "Goal scorer",
        PRED_SECOND_PLACE: "2nd place",
        PRED_THIRD_PLACE: "3rd place",
    }.get(ptype or "", ptype or "?")


def _wc_payout_status_label(pred: dict) -> str:
    ps = pred.get("payout_status")
    pts = int(pred.get("points_awarded") or 0)
    if not pred.get("settled"):
        return "Open"
    if pts <= 0:
        return "Lost"
    if ps == "pending":
        return "Pending pay"
    if ps == "paid":
        return "Paid"
    if ps == "ghost":
        return "Ghost"
    return "Paid"


def _team_brief(team: dict) -> dict:
    if not team:
        return {}
    return {k: team.get(k) for k in ("id", "name", "short_code", "group_id", "flag_emoji") if team.get(k)}


def _match_snapshot(match: Optional[dict], teams_by_id: dict) -> Optional[dict]:
    if not match:
        return None
    ht = teams_by_id.get(match.get("home_team_id")) or {}
    at = teams_by_id.get(match.get("away_team_id")) or {}
    if not ht.get("name") or not at.get("name"):
        from utils.world_cup_fixtures import team_briefs_from_official_schedule

        sh, sa = team_briefs_from_official_schedule(match, teams_by_id)
        if not ht.get("name") and sh:
            ht = sh
        if not at.get("name") and sa:
            at = sa
    res = match.get("result") or {}
    has_score = res.get("home_score") is not None and res.get("away_score") is not None
    return {
        "id": match.get("id"),
        "external_event_id": match.get("external_event_id"),
        "kickoff": match.get("kickoff"),
        "lock_at": match.get("lock_at"),
        "stage": match.get("stage"),
        "group_id": match.get("group_id"),
        "status": match.get("status"),
        "home_team": _team_brief(ht),
        "away_team": _team_brief(at),
        "label": f"{ht.get('name') or '?'} vs {at.get('name') or '?'}",
        "locked": _is_locked(match.get("lock_at")),
        "result": {
            "home_score": res.get("home_score"),
            "away_score": res.get("away_score"),
            "scorers": list(res.get("scorers") or []),
            "display": f"{res.get('home_score')}-{res.get('away_score')}" if has_score else None,
        } if has_score else None,
    }


def _points_for_type(cfg: dict, ptype: str, *, exact_score: bool = False) -> int:
    pts = _points_from_config(cfg)
    if ptype == PRED_GROUP_WINNER:
        return pts["group_winner_points"]
    if ptype == PRED_MATCH_SCORE:
        return pts["match_score_exact_points"] if exact_score else pts["match_score_result_points"]
    if ptype == PRED_MATCH_SCORER:
        return pts["match_scorer_points"]
    if ptype == PRED_SECOND_PLACE:
        return pts["second_place_points"]
    if ptype == PRED_THIRD_PLACE:
        return pts["third_place_points"]
    return 0


def _verification_for_prediction(
    pred: dict,
    ptype: str,
    target: str,
    val: dict,
    cfg: dict,
    teams_by_id: dict,
    matches_by_id: dict,
    groups_by_id: dict,
) -> dict:
    pick_display = ""
    actual_display = ""
    verdict = "pending"
    expected_points = 0

    if ptype == PRED_GROUP_WINNER:
        tid = val.get("team_id") if isinstance(val, dict) else val
        pick_display = _prediction_team_label(val, teams_by_id, tid)
        grp = groups_by_id.get(target) or {}
        winner_id = grp.get("winner_team_id")
        if winner_id:
            winner = teams_by_id.get(winner_id) or {}
            actual_display = winner.get("name") or _prediction_team_label({}, teams_by_id, winner_id)
            verdict = "correct" if str(tid) == str(winner_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_MATCH_SCORE:
        match = matches_by_id.get(target) or {}
        ht = teams_by_id.get(match.get("home_team_id")) or {}
        at = teams_by_id.get(match.get("away_team_id")) or {}
        ph = val.get("home") if isinstance(val, dict) else None
        pa = val.get("away") if isinstance(val, dict) else None
        pick_display = f"{ph}-{pa}" if ph is not None and pa is not None else "?"
        res = match.get("result") or {}
        if res.get("home_score") is not None and res.get("away_score") is not None:
            ah, aa = int(res["home_score"]), int(res["away_score"])
            actual_display = f"{ah}-{aa}"
            if ph == ah and pa == aa:
                verdict = "correct"
                expected_points = _points_for_type(cfg, ptype, exact_score=True)
            elif _match_result_outcome(int(ph), int(pa)) == _match_result_outcome(ah, aa):
                verdict = "result_correct"
                expected_points = _points_for_type(cfg, ptype, exact_score=False)
            else:
                verdict = "incorrect"
        else:
            actual_display = "—"
    elif ptype == PRED_MATCH_SCORER:
        match = matches_by_id.get(target) or {}
        pick_name = _norm_name(val.get("name") if isinstance(val, dict) else str(val or ""))
        pick_display = (val.get("name") if isinstance(val, dict) else str(val or "")) or "?"
        res = match.get("result") or {}
        scorers = [_norm_name(x) for x in (res.get("scorers") or []) if x]
        if scorers:
            actual_display = ", ".join(res.get("scorers") or [])
            verdict = "correct" if pick_name and pick_name in scorers else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_SECOND_PLACE:
        tid = val.get("team_id") if isinstance(val, dict) else val
        pick_display = _prediction_team_label(val, teams_by_id, tid)
        actual_id = cfg.get("runner_up_team_id")
        if actual_id:
            actual_display = _prediction_team_label({}, teams_by_id, actual_id)
            verdict = "correct" if str(tid) == str(actual_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_THIRD_PLACE:
        tid = val.get("team_id") if isinstance(val, dict) else val
        pick_display = _prediction_team_label(val, teams_by_id, tid)
        actual_id = cfg.get("third_place_team_id")
        if actual_id:
            actual_display = _prediction_team_label({}, teams_by_id, actual_id)
            verdict = "correct" if str(tid) == str(actual_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"

    return {
        "pick": pick_display,
        "actual": actual_display,
        "verdict": verdict,
        "expected_points": expected_points,
    }


def _enrich_prediction_for_staff(
    pred: dict,
    teams_by_id: dict,
    matches_by_id: dict,
    groups_by_id: dict,
    usernames: dict,
    entries_by_user: dict,
    cfg: dict,
) -> dict:
    ptype = pred.get("type")
    target = pred.get("target_id")
    val = pred.get("value") or {}
    uid = pred.get("user_id")
    entry = entries_by_user.get(uid) or {}
    verification = _verification_for_prediction(pred, ptype, target, val, cfg, teams_by_id, matches_by_id, groups_by_id)
    row = {
        "id": pred.get("id"),
        "user_id": uid,
        "username": usernames.get(uid, "?"),
        "type": ptype,
        "type_label": _prediction_type_label(ptype),
        "target_id": target,
        "value": val,
        "settled": bool(pred.get("settled")),
        "settled_at": pred.get("settled_at"),
        "payout_status": pred.get("payout_status"),
        "payout_status_label": _wc_payout_status_label(pred),
        "payout_approved_at": pred.get("payout_approved_at"),
        "points_awarded": int(pred.get("points_awarded") or 0),
        "points_display": int(pred.get("points_awarded") or 0) if pred.get("settled") else int(verification.get("expected_points") or 0),
        "settle_label": pred.get("settle_label") or "",
        "created_at": pred.get("created_at"),
        "updated_at": pred.get("updated_at"),
        "summary": "",
        "pick": verification["pick"],
        "actual": verification["actual"],
        "verdict": verification["verdict"],
        "expected_points": verification["expected_points"],
        "entrant": {
            "entered": bool(entry),
            "ghost_entry": bool(entry.get("ghost_entry")),
            "entered_at": entry.get("entered_at"),
            "drafted_team_count": len(entry.get("drafted_team_ids") or []),
        },
    }
    if ptype == PRED_GROUP_WINNER:
        tid = val.get("team_id") if isinstance(val, dict) else val
        pick_label = _prediction_team_label(val, teams_by_id, tid)
        team = teams_by_id.get(tid) or {}
        grp = groups_by_id.get(target) or {}
        row["summary"] = f"Group {target}: {pick_label}"
        row["team"] = _team_brief(team)
        row["group"] = {
            "group_id": target,
            "winner_team_id": grp.get("winner_team_id"),
            "winner_team": _team_brief(teams_by_id.get(grp.get("winner_team_id") or "")),
            "settled_at": grp.get("settled_at"),
        }
        row["target_label"] = f"Group {target}"
    elif ptype in (PRED_MATCH_SCORE, PRED_MATCH_SCORER):
        match = matches_by_id.get(target) or {}
        snap = _match_snapshot(match, teams_by_id)
        row["match"] = snap
        row["target_label"] = snap.get("label") if snap else target
        if ptype == PRED_MATCH_SCORE:
            h, a = val.get("home"), val.get("away")
            row["summary"] = f"{row['target_label']} → pick {h}-{a}"
        else:
            scorer = val.get("name") if isinstance(val, dict) else str(val or "")
            row["summary"] = f"{row['target_label']} → scorer: {scorer or '?'}"
    elif ptype in (PRED_SECOND_PLACE, PRED_THIRD_PLACE):
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        place = "2nd" if ptype == PRED_SECOND_PLACE else "3rd"
        row["summary"] = f"{place} place: {team.get('name') or '?'}"
        row["team"] = _team_brief(team)
        row["target_label"] = "Tournament"
        row["tournament"] = {
            "runner_up_team_id": cfg.get("runner_up_team_id"),
            "third_place_team_id": cfg.get("third_place_team_id"),
            "champion_team_id": cfg.get("champion_team_id"),
        }
    else:
        row["summary"] = str(val)[:120]
        row["target_label"] = target
    return row


async def _build_staff_predictions_feed(
    db,
    limit: int = 500,
    pred_type: Optional[str] = None,
    match_id: Optional[str] = None,
    group_id: Optional[str] = None,
    username: Optional[str] = None,
    settled: Optional[bool] = None,
    payout_status: Optional[str] = None,
    verdict: Optional[str] = None,
) -> dict:
    await _ensure_orphan_team_ids_healed(db)
    cfg = await _load_config(db)
    q: dict = {}
    if pred_type:
        q["type"] = pred_type
    if match_id:
        q["target_id"] = match_id
        q["type"] = {"$in": [PRED_MATCH_SCORE, PRED_MATCH_SCORER]}
    elif group_id:
        q["target_id"] = group_id.upper()
        q["type"] = PRED_GROUP_WINNER
    if settled is not None:
        q["settled"] = bool(settled)
    if payout_status:
        q["payout_status"] = payout_status
    if username and username.strip():
        uname = username.strip()
        user_ids = []
        async for u in db.users.find(
            {"username": {"$regex": re.escape(uname), "$options": "i"}},
            {"_id": 0, "id": 1},
        ).limit(50):
            if u.get("id"):
                user_ids.append(u["id"])
        if not user_ids:
            return {"predictions": [], "counts": {}, "total_shown": 0, "matches": [], "points_reference": _points_from_config(cfg)}
        q["user_id"] = {"$in": user_ids}
    lim = max(1, min(int(limit), 2000))
    preds = await db.world_cup_predictions.find(q, {"_id": 0}).sort("updated_at", -1).limit(lim).to_list(lim)
    teams_by_id = await _teams_by_id_resolved(db)
    matches_by_id = {}
    async for m in db.world_cup_matches.find({}, {"_id": 0}):
        mid = m.get("id")
        if mid:
            matches_by_id[mid] = m
    groups_by_id = {}
    async for g in db.world_cup_groups.find({}, {"_id": 0}):
        gid = g.get("group_id")
        if gid:
            groups_by_id[gid] = g
    user_ids = list({p.get("user_id") for p in preds if p.get("user_id")})
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    entries_by_user = {}
    if user_ids:
        async for e in db.world_cup_entries.find({"user_id": {"$in": user_ids}}, {"_id": 0}):
            entries_by_user[e.get("user_id")] = e
    enriched = [
        _enrich_prediction_for_staff(p, teams_by_id, matches_by_id, groups_by_id, usernames, entries_by_user, cfg)
        for p in preds
    ]
    if verdict:
        enriched = [r for r in enriched if r.get("verdict") == verdict]
    counts = {}
    async for doc in db.world_cup_predictions.aggregate([{"$group": {"_id": "$type", "n": {"$sum": 1}}}]):
        counts[doc["_id"]] = int(doc["n"])
    match_pred_counts = await _prediction_target_counts(db, [PRED_MATCH_SCORE, PRED_MATCH_SCORER])
    group_pred_counts = await _prediction_target_counts(db, [PRED_GROUP_WINNER])
    match_options = []
    for mid, m in matches_by_id.items():
        snap = _match_snapshot(m, teams_by_id)
        match_options.append({
            "id": mid,
            "label": snap.get("label") if snap else f"{mid}",
            "kickoff": m.get("kickoff"),
            "stage": m.get("stage"),
            "status": m.get("status"),
            "result": (snap or {}).get("result"),
            "prediction_count": match_pred_counts.get(mid, 0),
        })
    match_options.sort(key=lambda x: x.get("kickoff") or "")
    group_options = []
    for gid in GROUP_IDS:
        grp = groups_by_id.get(gid) or {}
        winner = teams_by_id.get(grp.get("winner_team_id") or "") or {}
        group_options.append({
            "group_id": gid,
            "winner_team": _team_brief(winner),
            "settled": bool(grp.get("winner_team_id")),
            "prediction_count": group_pred_counts.get(gid, 0),
        })
    return {
        "predictions": enriched,
        "counts": counts,
        "total_shown": len(enriched),
        "matches": match_options,
        "groups": group_options,
        "points_reference": _points_from_config(cfg),
        "tournament": {
            "champion_team_id": cfg.get("champion_team_id"),
            "runner_up_team_id": cfg.get("runner_up_team_id"),
            "third_place_team_id": cfg.get("third_place_team_id"),
        },
    }


async def _settle_group_predictions(db, send_notification, cfg: dict, group_id: str, winner_team_id: str) -> int:
    pts_cfg = _points_from_config(cfg)
    pts = pts_cfg["group_winner_points"]
    count = 0
    cursor = db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "target_id": group_id, "settled": {"$ne": True}},
        {"_id": 0},
    )
    async for pred in cursor:
        pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
        if str(pick) != str(winner_team_id):
            await _settle_prediction_doc(db, send_notification, pred, 0, f"Group {group_id} (incorrect)")
            count += 1
            continue
        if await _settle_prediction_doc(db, send_notification, pred, pts, f"Group {group_id} winner"):
            count += 1
    await db.world_cup_groups.update_one(
        {"group_id": group_id},
        {"$set": {"winner_team_id": winner_team_id, "settled_at": _now_iso()}},
        upsert=True,
    )
    await db.world_cup_predictions.update_many(
        {"type": PRED_GROUP_WINNER, "target_id": group_id},
        {"$set": {"actual_winner_team_id": winner_team_id}},
    )
    await _persist_official_group_winner(db, group_id, winner_team_id)
    return count


def _match_result_outcome(home: int, away: int) -> str:
    if home > away:
        return "home"
    if away > home:
        return "away"
    return "draw"


async def _settle_match_predictions(db, send_notification, cfg: dict, match: dict) -> int:
    result = match.get("result") or {}
    h = int(result.get("home_score") if result.get("home_score") is not None else -1)
    a = int(result.get("away_score") if result.get("away_score") is not None else -1)
    if h < 0 or a < 0:
        return 0
    pts_cfg = _points_from_config(cfg)
    mid = match.get("id")
    count = 0
    actual_outcome = _match_result_outcome(h, a)
    scorers = {_norm_name(x) for x in (result.get("scorers") or []) if x}

    cursor = db.world_cup_predictions.find(
        {"target_id": mid, "type": {"$in": [PRED_MATCH_SCORE, PRED_MATCH_SCORER]}, "settled": {"$ne": True}},
        {"_id": 0},
    )
    async for pred in cursor:
        ptype = pred.get("type")
        val = pred.get("value") or {}
        if ptype == PRED_MATCH_SCORE:
            ph = int(val.get("home") if val.get("home") is not None else -999)
            pa = int(val.get("away") if val.get("away") is not None else -999)
            if ph == h and pa == a:
                pts = pts_cfg["match_score_exact_points"]
                label = f"Exact score {h}-{a}"
            elif _match_result_outcome(ph, pa) == actual_outcome:
                pts = pts_cfg["match_score_result_points"]
                label = "Correct match result"
            else:
                pts = 0
                label = "Incorrect score"
            if await _settle_prediction_doc(db, send_notification, pred, pts, label):
                count += 1
        elif ptype == PRED_MATCH_SCORER and scorers:
            name = _norm_name(val.get("name") if isinstance(val, dict) else str(val))
            if name and name in scorers:
                if await _settle_prediction_doc(
                    db, send_notification, pred, pts_cfg["match_scorer_points"], "Correct goal scorer"
                ):
                    count += 1
            else:
                if await _settle_prediction_doc(db, send_notification, pred, 0, "Incorrect scorer"):
                    count += 1
    return count


def _compute_group_standings(group_teams: list, matches: list) -> list:
    """Return team_ids sorted best-first by pts, GD, GF."""
    stats = {tid: {"pts": 0, "gf": 0, "ga": 0} for tid in group_teams}
    for m in matches:
        res = m.get("result") or {}
        h_id, a_id = m.get("home_team_id"), m.get("away_team_id")
        try:
            hs = int(res.get("home_score"))
            as_ = int(res.get("away_score"))
        except (TypeError, ValueError):
            continue
        if h_id in stats:
            stats[h_id]["gf"] += hs
            stats[h_id]["ga"] += as_
        if a_id in stats:
            stats[a_id]["gf"] += as_
            stats[a_id]["ga"] += hs
        if hs > as_:
            if h_id in stats:
                stats[h_id]["pts"] += 3
        elif as_ > hs:
            if a_id in stats:
                stats[a_id]["pts"] += 3
        else:
            if h_id in stats:
                stats[h_id]["pts"] += 1
            if a_id in stats:
                stats[a_id]["pts"] += 1

    def sort_key(tid):
        s = stats[tid]
        gd = s["gf"] - s["ga"]
        return (s["pts"], gd, s["gf"])

    return sorted(group_teams, key=sort_key, reverse=True)


async def _try_settle_group(db, send_notification, cfg: dict, group_id: str) -> bool:
    grp = await db.world_cup_groups.find_one({"group_id": group_id}, {"_id": 0})
    if grp and grp.get("winner_team_id"):
        if grp.get("settled_at"):
            unsettled = await db.world_cup_predictions.count_documents(
                {"type": PRED_GROUP_WINNER, "target_id": group_id, "settled": {"$ne": True}}
            )
            if unsettled <= 0:
                return False
            await _settle_group_predictions(db, send_notification, cfg, group_id, grp["winner_team_id"])
            return True
        await _settle_group_predictions(db, send_notification, cfg, group_id, grp["winner_team_id"])
        return True
    gteams = grp.get("team_ids") if grp else []
    if not gteams:
        tdocs = await db.world_cup_teams.find({"group_id": group_id}, {"_id": 0, "id": 1}).to_list(10)
        gteams = [t["id"] for t in tdocs]
    if len(gteams) < 2:
        return False
    matches = await db.world_cup_matches.find(
        {"group_id": group_id, "stage": "group", "status": "settled"},
        {"_id": 0},
    ).to_list(20)
    expected = len(gteams) * (len(gteams) - 1) // 2
    if len(matches) < expected:
        return False
    ranked = _compute_group_standings(gteams, matches)
    winner = ranked[0]
    await _settle_group_predictions(db, send_notification, cfg, group_id, winner)
    return True


async def _resolve_winner_team_in_group(
    db,
    group_id: str,
    *,
    team_id: Optional[str] = None,
    team_name: Optional[str] = None,
) -> dict:
    gid = (group_id or "").strip().upper()
    if gid not in GROUP_IDS:
        raise HTTPException(status_code=400, detail=f"Invalid group {group_id}")
    tid = (team_id or "").strip()
    if tid:
        team = await db.world_cup_teams.find_one({"id": tid}, {"_id": 0})
        if not team or (team.get("group_id") or "").upper() != gid:
            raise HTTPException(status_code=400, detail="Team is not in that group")
        return team
    name = (team_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Provide team_id or team_name")
    teams_by_id = await _teams_by_id(db)
    nm = _norm_name(name)
    for t in teams_by_id.values():
        if (t.get("group_id") or "").upper() != gid:
            continue
        if _norm_name(t.get("name")) == nm:
            return t
        for alias in t.get("odds_api_names") or []:
            if _norm_name(alias) == nm:
                return t
        if sb._team_matches_option(t.get("name") or "", name):
            return t
    pattern = re.compile("^" + re.escape(name) + "$", re.IGNORECASE)
    team = await db.world_cup_teams.find_one({"group_id": gid, "name": pattern}, {"_id": 0})
    if not team:
        team = await db.world_cup_teams.find_one({"group_id": gid, "short_code": pattern}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail=f"No team '{name}' in group {gid}")
    return team


_GROUP_PICK_LINE_RE = re.compile(
    r"^\s*Group\s+([A-L])\s*(?:[:=\-–—]\s*|\s+)\s*(.+?)\s*$",
    re.IGNORECASE,
)


def _parse_group_picks_text(text: str) -> Dict[str, str]:
    """Parse forum/Discord lines: Group A: Mexico, Group A - Mexico"""
    out: Dict[str, str] = {}
    for line in (text or "").splitlines():
        m = _GROUP_PICK_LINE_RE.match(line.strip())
        if not m:
            continue
        gid = m.group(1).upper()
        if gid in GROUP_IDS:
            out[gid] = m.group(2).strip()
    return out


async def _reverse_prediction_payout_if_needed(db, pred: dict) -> bool:
    """Claw back points if a settled prediction was already paid (staff correction)."""
    if pred.get("payout_status") != "paid":
        return False
    pts = int(pred.get("points_awarded") or 0)
    uid = pred.get("user_id") or ""
    if pts <= 0 or not uid:
        return False
    await db.users.update_one({"id": uid}, {"$inc": {"points": -pts}})
    await log_points_event(
        db,
        user_id=uid,
        points=-pts,
        event_type="world_cup_pick_correction",
        meta={"prediction_id": pred.get("id"), "reason": "staff_group_pick_restore"},
    )
    return True


async def _group_winner_id_for_preview(db, cfg: dict, group_id: str, teams_by_id: dict) -> tuple[Optional[str], Optional[str]]:
    """Return (winner_team_id, winner_name) for a group if known."""
    gid = (group_id or "").strip().upper()
    grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
    wid = (grp or {}).get("winner_team_id")
    if wid:
        team = teams_by_id.get(str(wid)) or {}
        return str(wid), team.get("name")
    sc = (cfg.get("official_group_winners") or {}).get(gid)
    if sc:
        tid = await _winner_id_from_short_code(str(sc), teams_by_id)
        if tid:
            team = teams_by_id.get(str(tid)) or {}
            return str(tid), team.get("name")
    return None, None


async def _preview_user_group_picks_from_text(
    db,
    *,
    username: str,
    picks: Optional[Dict[str, str]] = None,
    picks_text: Optional[str] = None,
) -> dict:
    """Score pasted group-winner picks against settled winners (no DB writes)."""
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    merged = dict(picks or {})
    merged.update(_parse_group_picks_text(picks_text or ""))
    if not merged:
        raise HTTPException(status_code=400, detail="No group picks provided (use picks map or picks_text)")

    user = await db.users.find_one(
        {"username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    uid = user["id"]
    cfg = await _load_config(db)
    pts_cfg = _points_from_config(cfg)
    pts_per = int(pts_cfg["group_winner_points"])
    teams_by_id = await _teams_by_id(db)
    entry = await db.world_cup_entries.find_one({"user_id": uid}, {"_id": 0, "ghost_entry": 1})

    groups_out: List[dict] = []
    parse_errors: List[dict] = []
    total_correct = 0
    total_points = 0
    unsettled_groups = 0

    for gid in GROUP_IDS:
        team_name = (merged.get(gid) or "").strip()
        if not team_name:
            continue
        pred = await db.world_cup_predictions.find_one(
            {"user_id": uid, "type": PRED_GROUP_WINNER, "target_id": gid},
            {"_id": 0},
        )
        current_val = pred.get("value") if pred and isinstance(pred.get("value"), dict) else {}
        current_pick = current_val.get("team_name") or (
            teams_by_id.get(str(current_val.get("team_id") or "")) or {}
        ).get("name")
        try:
            team = await _resolve_winner_team_in_group(db, gid, team_name=team_name)
        except HTTPException as ex:
            parse_errors.append({"group_id": gid, "pick": team_name, "error": ex.detail})
            continue
        winner_tid, winner_name = await _group_winner_id_for_preview(db, cfg, gid, teams_by_id)
        settled = bool(winner_tid)
        correct = settled and str(team.get("id")) == str(winner_tid)
        points = pts_per if correct else 0
        if settled:
            if correct:
                total_correct += 1
                total_points += points
        else:
            unsettled_groups += 1
        action = "unchanged"
        if not pred:
            action = "create"
        elif str(current_val.get("team_id") or "") != str(team.get("id")):
            action = "update"
        groups_out.append({
            "group_id": gid,
            "pick": team.get("name"),
            "pick_team_id": team.get("id"),
            "actual_winner": winner_name,
            "actual_winner_id": winner_tid,
            "settled": settled,
            "correct": correct,
            "points": points,
            "current_db_pick": current_pick,
            "action": action,
            "existing_settled": bool(pred and pred.get("settled")),
            "existing_payout_status": pred.get("payout_status") if pred else None,
            "existing_points_awarded": int(pred.get("points_awarded") or 0) if pred else 0,
        })

    return {
        "ok": True,
        "username": user.get("username") or uname,
        "user_id": uid,
        "has_entry": bool(entry),
        "ghost_entry": bool(entry and entry.get("ghost_entry")),
        "groups_parsed": len(groups_out),
        "groups_in_text": len(merged),
        "parse_errors": parse_errors,
        "unsettled_groups": unsettled_groups,
        "correct_groups": total_correct,
        "points_per_correct": pts_per,
        "total_points_if_settled": total_points,
        "groups": groups_out,
    }


async def _approve_user_pending_group_payouts(
    db,
    send_notification,
    user_id: str,
    approver_id: str,
) -> dict:
    preds = await db.world_cup_predictions.find(
        {
            "user_id": user_id,
            "type": PRED_GROUP_WINNER,
            "payout_status": "pending",
        },
        {"_id": 0, "id": 1},
    ).to_list(20)
    approved = 0
    points = 0
    for pred in preds:
        pid = pred.get("id")
        if not pid:
            continue
        try:
            result = await _approve_prediction_payout(db, send_notification, pid, approver_id)
            approved += 1
            points += int(result.get("points") or 0)
        except HTTPException:
            continue
    return {"predictions_approved": approved, "points": points}


async def _staff_restore_user_group_picks(
    db,
    send_notification,
    *,
    username: str,
    picks: Optional[Dict[str, str]] = None,
    picks_text: Optional[str] = None,
    re_settle: bool = True,
    create_missing: bool = True,
    auto_approve: bool = False,
    approver_id: str = "",
) -> dict:
    """Restore a player's group-winner picks from staff-provided team names (e.g. Discord log)."""
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    merged = dict(picks or {})
    merged.update(_parse_group_picks_text(picks_text or ""))
    if not merged:
        raise HTTPException(status_code=400, detail="No group picks provided (use picks map or picks_text)")

    user = await db.users.find_one(
        {"username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    uid = user["id"]
    cfg = await _load_config(db)
    updated: List[dict] = []
    groups_to_reset: set = set()

    for gid in GROUP_IDS:
        team_name = (merged.get(gid) or "").strip()
        if not team_name:
            continue
        team = await _resolve_winner_team_in_group(db, gid, team_name=team_name)
        pred = await db.world_cup_predictions.find_one(
            {"user_id": uid, "type": PRED_GROUP_WINNER, "target_id": gid},
            {"_id": 0},
        )
        if not pred:
            if not create_missing:
                continue
            entry = await db.world_cup_entries.find_one({"user_id": uid}, {"_id": 0, "user_id": 1})
            if not entry:
                await db.world_cup_entries.insert_one({
                    "user_id": uid,
                    "entered_at": _now_iso(),
                    "drafted_team_ids": [],
                    "staff_imported": True,
                })
            pid = str(uuid.uuid4())
            now = _now_iso()
            val = {
                "team_id": team.get("id"),
                "team_name": team.get("name"),
                "short_code": team.get("short_code"),
            }
            await db.world_cup_predictions.insert_one({
                "id": pid,
                "user_id": uid,
                "type": PRED_GROUP_WINNER,
                "target_id": gid,
                "value": val,
                "settled": False,
                "points_awarded": 0,
                "payout_status": "none",
                "created_at": now,
                "updated_at": now,
                "staff_imported": True,
            })
            await _wc_upsert_group_pick_snapshot(db, uid, gid, val, source="staff_import")
            updated.append({
                "group_id": gid,
                "team_name": team.get("name"),
                "team_id": team.get("id"),
                "was_settled": False,
                "created": True,
            })
            continue
        val = pred.get("value") or {}
        old_tid = val.get("team_id") if isinstance(val, dict) else val
        new_tid = team.get("id")
        if str(old_tid) == str(new_tid):
            continue
        if pred.get("settled"):
            await _reverse_prediction_payout_if_needed(db, pred)
            groups_to_reset.add(gid)
            await db.world_cup_predictions.update_one(
                {"id": pred["id"]},
                {
                    "$set": {
                        "settled": False,
                        "points_awarded": 0,
                        "payout_status": "none",
                        "value": {
                            "team_id": new_tid,
                            "team_name": team.get("name"),
                            "short_code": team.get("short_code"),
                        },
                        "updated_at": _now_iso(),
                    },
                    "$unset": {
                        "settled_at": "",
                        "settle_label": "",
                        "payout_approved_at": "",
                        "payout_approved_by": "",
                    },
                },
            )
        else:
            await db.world_cup_predictions.update_one(
                {"id": pred["id"]},
                {
                    "$set": {
                        "value": {
                            "team_id": new_tid,
                            "team_name": team.get("name"),
                            "short_code": team.get("short_code"),
                        },
                        "updated_at": _now_iso(),
                    }
                },
            )
        updated.append({
            "group_id": gid,
            "team_name": team.get("name"),
            "team_id": new_tid,
            "was_settled": bool(pred.get("settled")),
        })

    re_settled = 0
    if re_settle and groups_to_reset:
        for gid in sorted(groups_to_reset):
            grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
            wid = grp.get("winner_team_id") if grp else None
            if wid:
                re_settled += await _settle_group_predictions(db, send_notification, cfg, gid, wid)
    elif re_settle:
        for gid in GROUP_IDS:
            if gid not in merged:
                continue
            pred = await db.world_cup_predictions.find_one(
                {"user_id": uid, "type": PRED_GROUP_WINNER, "target_id": gid, "settled": {"$ne": True}},
                {"_id": 0, "id": 1},
            )
            if not pred:
                continue
            grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
            wid = grp.get("winner_team_id") if grp else None
            if not wid:
                sc = (cfg.get("official_group_winners") or {}).get(gid)
                if sc:
                    wid = await _winner_id_from_short_code(str(sc), await _teams_by_id(db))
            if wid:
                re_settled += await _settle_group_predictions(db, send_notification, cfg, gid, wid)

    payout = None
    if auto_approve and approver_id:
        payout = await _approve_user_pending_group_payouts(db, send_notification, uid, approver_id)

    return {
        "ok": True,
        "username": user.get("username") or uname,
        "user_id": uid,
        "groups_updated": len(updated),
        "groups_re_settled": re_settled,
        "details": updated,
        "payout": payout,
    }


async def _resolve_group_pick_team_for_restore(
    db,
    *,
    group_id: str,
    current_value: dict,
    snapshot: Optional[dict],
    chat_picks: Dict[str, str],
    high_conf_map: Dict[str, str],
    teams_by_id: dict,
) -> tuple[Optional[dict], Optional[str]]:
    """Return (team_doc, source_label) for restoring a group-winner pick."""
    gid = (group_id or "").strip().upper()
    val = current_value if isinstance(current_value, dict) else {}
    snap = snapshot or {}

    stored_name = (snap.get("team_name") or val.get("team_name") or chat_picks.get(gid) or "").strip()
    if stored_name:
        current_tid = val.get("team_id")
        current_team = teams_by_id.get(str(current_tid)) or {}
        if _norm_name(current_team.get("name")) != _norm_name(stored_name):
            try:
                team = await _resolve_winner_team_in_group(db, gid, team_name=stored_name)
                source = "snapshot" if snap.get("team_name") else (
                    "team_name" if val.get("team_name") else "chat"
                )
                return team, source
            except HTTPException:
                pass

    for legacy_field in ("original_team_id", "team_id"):
        legacy_tid = snap.get(legacy_field) or val.get("original_team_id") or (
            val.get(legacy_field) if legacy_field == "team_id" else None
        )
        if not legacy_tid or not _is_legacy_team_id(legacy_tid):
            continue
        stable_tid = high_conf_map.get(str(legacy_tid))
        if stable_tid and teams_by_id.get(stable_tid):
            return teams_by_id[stable_tid], "legacy_map"

    snap_tid = snap.get("team_id")
    if snap_tid and not _is_legacy_team_id(snap_tid) and teams_by_id.get(str(snap_tid)):
        current_tid = str(val.get("team_id") or "")
        if current_tid != str(snap_tid):
            return teams_by_id[str(snap_tid)], "snapshot_id"

    return None, None


async def _auto_restore_all_group_picks(
    db,
    send_notification,
    *,
    re_settle: bool = True,
    dry_run: bool = False,
) -> dict:
    """
    Restore every player's group-winner picks from saved snapshots, stored team names,
    chat/inbox posts, or high-confidence legacy team-id maps.
    """
    teams_by_id = await _teams_by_id(db)
    high_conf_map = await _build_high_confidence_old_team_map(db)
    backup_picks = await _collect_group_picks_from_backup_collection(db)
    chat_by_user = await _collect_group_picks_from_messages(db)
    for uid, picks in backup_picks.items():
        merged = chat_by_user.setdefault(uid, {})
        for gid, name in picks.items():
            merged.setdefault(gid, name)

    snaps_by_key: Dict[tuple, dict] = {}
    async for s in db[WC_PICK_SNAPSHOT_COL].find({}, {"_id": 0}):
        uid = s.get("user_id")
        gid = (s.get("group_id") or "").upper()
        if uid and gid:
            snaps_by_key[(uid, gid)] = s

    usernames: Dict[str, str] = {}
    users_touched: set = set()
    groups_updated = 0
    groups_re_settled = 0
    groups_to_reset: set = set()
    sources: Dict[str, int] = {}
    details: List[dict] = []

    async for p in db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "value.team_id": {"$exists": True}},
        {"_id": 0},
    ):
        uid = p.get("user_id") or ""
        gid = (p.get("target_id") or "").upper()
        if not uid or gid not in GROUP_IDS:
            continue
        val = p.get("value") or {}
        if not isinstance(val, dict):
            continue
        snap = snaps_by_key.get((uid, gid)) or {}

        team, source = await _resolve_group_pick_team_for_restore(
            db,
            group_id=gid,
            current_value=val,
            snapshot=snap,
            chat_picks=chat_by_user.get(uid) or {},
            high_conf_map=high_conf_map,
            teams_by_id=teams_by_id,
        )
        if not team:
            continue

        new_tid = team.get("id")
        if str(val.get("team_id")) == str(new_tid):
            continue

        if uid not in usernames:
            u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
            usernames[uid] = (u or {}).get("username") or "?"

        row = {
            "user_id": uid,
            "username": usernames[uid],
            "group_id": gid,
            "team_name": team.get("name"),
            "team_id": new_tid,
            "source": source,
            "was_settled": bool(p.get("settled")),
        }
        details.append(row)
        sources[source] = sources.get(source, 0) + 1
        users_touched.add(uid)
        groups_updated += 1

        if dry_run:
            continue

        new_value = {
            "team_id": new_tid,
            "team_name": team.get("name"),
            "short_code": team.get("short_code"),
            "original_team_id": val.get("original_team_id") or snap.get("original_team_id") or val.get("team_id"),
        }
        if p.get("settled"):
            await _reverse_prediction_payout_if_needed(db, p)
            groups_to_reset.add(gid)
            await db.world_cup_predictions.update_one(
                {"id": p["id"]},
                {
                    "$set": {
                        "settled": False,
                        "points_awarded": 0,
                        "payout_status": "none",
                        "value": new_value,
                        "updated_at": _now_iso(),
                    },
                    "$unset": {
                        "settled_at": "",
                        "settle_label": "",
                        "payout_approved_at": "",
                        "payout_approved_by": "",
                    },
                },
            )
        else:
            await db.world_cup_predictions.update_one(
                {"id": p["id"]},
                {"$set": {"value": new_value, "updated_at": _now_iso()}},
            )

    if not dry_run and re_settle and groups_to_reset:
        cfg = await _load_config(db)
        for gid in sorted(groups_to_reset):
            grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0, "winner_team_id": 1})
            wid = grp.get("winner_team_id") if grp else None
            if wid:
                groups_re_settled += await _settle_group_predictions(
                    db, send_notification, cfg, gid, wid,
                )

    return {
        "ok": True,
        "dry_run": dry_run,
        "users_updated": len(users_touched),
        "groups_updated": groups_updated,
        "groups_re_settled": groups_re_settled,
        "snapshots_loaded": len(snaps_by_key),
        "chat_users": len(chat_by_user),
        "backup_users": len(backup_picks),
        "sources": sources,
        "details": details[:200],
    }


async def _reset_group_winner_settlement(db, group_id: str) -> int:
    res = await db.world_cup_predictions.update_many(
        {"type": PRED_GROUP_WINNER, "target_id": group_id, "settled": True},
        {
            "$set": {"settled": False, "points_awarded": 0, "payout_status": "none"},
            "$unset": {
                "settled_at": "",
                "settle_label": "",
                "payout_approved_at": "",
                "payout_approved_by": "",
            },
        },
    )
    await db.world_cup_groups.update_one(
        {"group_id": group_id},
        {"$unset": {"winner_team_id": "", "settled_at": ""}},
    )
    return int(res.modified_count or 0)


async def _set_group_winner_manual(
    db,
    send_notification,
    cfg: dict,
    group_id: str,
    winner_team_id: str,
    *,
    force: bool = False,
) -> dict:
    gid = (group_id or "").strip().upper()
    grp = await db.world_cup_groups.find_one({"group_id": gid}, {"_id": 0})
    if grp and grp.get("settled_at"):
        same_winner = str(grp.get("winner_team_id") or "") == str(winner_team_id)
        if same_winner and not force:
            count = await _settle_group_predictions(db, send_notification, cfg, gid, winner_team_id)
            team = await db.world_cup_teams.find_one({"id": winner_team_id}, {"_id": 0, "name": 1})
            return {
                "group_id": gid,
                "winner_team_id": winner_team_id,
                "winner_name": (team or {}).get("name"),
                "predictions_settled": count,
                "already_settled": True,
            }
        if not force:
            raise HTTPException(
                status_code=400,
                detail=f"Group {gid} already settled. Pass force=true to change the winner.",
            )
        await _reset_group_winner_settlement(db, gid)
    count = await _settle_group_predictions(db, send_notification, cfg, gid, winner_team_id)
    team = await db.world_cup_teams.find_one({"id": winner_team_id}, {"_id": 0, "name": 1})
    return {
        "group_id": gid,
        "winner_team_id": winner_team_id,
        "winner_name": (team or {}).get("name"),
        "predictions_settled": count,
        "already_settled": False,
    }


async def _settle_all_groups_comprehensive(db, send_notification, cfg: dict) -> dict:
    details = []
    settled_count = 0
    for gid in GROUP_IDS:
        if await _try_settle_group(db, send_notification, cfg, gid):
            settled_count += 1
            details.append({"group_id": gid, "method": "auto"})
    return {"groups_settled": settled_count, "details": details}


async def _build_groups_setup(db) -> dict:
    teams_by_id = await _teams_by_id(db)
    groups_by_id = {}
    async for g in db.world_cup_groups.find({}, {"_id": 0}):
        gid = g.get("group_id")
        if gid:
            groups_by_id[gid] = g
    groups_out = []
    for gid in GROUP_IDS:
        grp = groups_by_id.get(gid) or {}
        teams = [
            _team_brief(t)
            for t in teams_by_id.values()
            if (t.get("group_id") or "").upper() == gid
        ]
        teams.sort(key=lambda x: x.get("name") or "")
        winner_id = grp.get("winner_team_id")
        groups_out.append({
            "group_id": gid,
            "teams": teams,
            "winner_team": _team_brief(teams_by_id.get(winner_id) or {}) if winner_id else None,
            "winner_team_id": winner_id,
            "settled_at": grp.get("settled_at"),
            "settled": bool(grp.get("settled_at")),
        })
    return {"groups": groups_out, "group_winner_points": _points_from_config(await _load_config(db))["group_winner_points"]}


async def _resolve_winner_pick_in_group(db, group_id: str, pick: str) -> dict:
    pick_s = (pick or "").strip()
    if not pick_s:
        raise HTTPException(status_code=400, detail="Empty team pick")
    gid = (group_id or "").strip().upper()
    by_id = await db.world_cup_teams.find_one({"id": pick_s, "group_id": gid}, {"_id": 0})
    if by_id:
        return by_id
    return await _resolve_winner_team_in_group(db, gid, team_name=pick_s)


async def _build_staff_match_picker(db) -> list:
    """Matches for entertainer result entry — unsettled / no score first, then by kickoff."""
    teams = await _teams_by_id(db)
    rows = await db.world_cup_matches.find({}, {"_id": 0}).sort("kickoff", 1).to_list(500)
    out = []
    for m in rows:
        snap = _match_snapshot(m, teams)
        if not snap:
            continue
        res = snap.get("result") or {}
        has_score = res.get("home_score") is not None and res.get("away_score") is not None
        needs_result = (m.get("status") or "") != "settled" or not has_score
        out.append({**snap, "needs_result": needs_result})
    out.sort(key=lambda x: (not x.get("needs_result"), x.get("kickoff") or ""), reverse=False)
    # Within needs_result bucket, most recent kickoff first
    pending = [x for x in out if x.get("needs_result")]
    done = [x for x in out if not x.get("needs_result")]
    pending.sort(key=lambda x: x.get("kickoff") or "", reverse=True)
    done.sort(key=lambda x: x.get("kickoff") or "", reverse=True)
    return pending + done


async def _apply_match_result(db, send_notification, cfg: dict, match_id: str, home_score: int, away_score: int, scorers: Optional[list] = None) -> dict:
    match = await db.world_cup_matches.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    result = {"home_score": int(home_score), "away_score": int(away_score), "scorers": list(scorers or match.get("result", {}).get("scorers") or [])}
    await db.world_cup_matches.update_one(
        {"id": match_id},
        {"$set": {"status": "settled", "result": result, "settled_at": _now_iso()}},
    )
    match = {**match, "status": "settled", "result": result}
    settled_preds = await _settle_match_predictions(db, send_notification, cfg, match)
    groups_settled = 0
    gid = match.get("group_id")
    if match.get("stage") == "group" and gid:
        if await _try_settle_group(db, send_notification, cfg, gid):
            groups_settled = 1
    stage = (match.get("stage") or "").lower()
    tourney = await _maybe_settle_tournament_from_match(db, send_notification, cfg, match, stage)
    return {"match_id": match_id, "predictions_settled": settled_preds, "groups_settled": groups_settled, **tourney}


async def _maybe_settle_tournament_from_match(db, send_notification, cfg: dict, match: dict, stage: str) -> dict:
    out = {"tournament_settled": False}
    res = match.get("result") or {}
    try:
        hs, as_ = int(res["home_score"]), int(res["away_score"])
    except (TypeError, ValueError, KeyError):
        return out
    home_id, away_id = match.get("home_team_id"), match.get("away_team_id")
    if stage == "third_place":
        third = home_id if hs > as_ else away_id
        await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"third_place_team_id": third}})
        pts = _points_from_config(cfg)["third_place_points"]
        cursor = db.world_cup_predictions.find({"type": PRED_THIRD_PLACE, "settled": {"$ne": True}}, {"_id": 0})
        async for pred in cursor:
            pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
            pts_aw = pts if str(pick) == str(third) else 0
            await _settle_prediction_doc(db, send_notification, pred, pts_aw, "3rd place")
        out["third_place_settled"] = True
    elif stage == "final":
        champion = home_id if hs > as_ else away_id
        runner_up = away_id if hs > as_ else home_id
        await db.game_config.update_one(
            {"id": CONFIG_ID},
            {"$set": {"champion_team_id": champion, "runner_up_team_id": runner_up, "phase": "completed"}},
        )
        pts2 = _points_from_config(cfg)["second_place_points"]
        cursor = db.world_cup_predictions.find({"type": PRED_SECOND_PLACE, "settled": {"$ne": True}}, {"_id": 0})
        async for pred in cursor:
            pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
            pts_aw = pts2 if str(pick) == str(runner_up) else 0
            await _settle_prediction_doc(db, send_notification, pred, pts_aw, "2nd place")
        jackpot = _points_from_config(cfg)["jackpot_points"]
        now = _now_iso()
        async for entry in db.world_cup_entries.find(
            {
                "jackpot_awarded": {"$ne": True},
                "jackpot_pending": {"$ne": True},
                "ghost_entry": {"$ne": True},
            },
            {"_id": 0},
        ):
            drafted = entry.get("drafted_team_ids") or []
            if str(champion) not in [str(x) for x in drafted]:
                continue
            uid = entry.get("user_id")
            if not uid:
                continue
            await db.world_cup_entries.update_one(
                {"user_id": uid},
                {
                    "$set": {
                        "jackpot_pending": True,
                        "jackpot_points_pending": jackpot,
                        "jackpot_pending_at": now,
                        "jackpot_champion_team_id": champion,
                        "jackpot_label": "World Cup champion (draft)",
                    }
                },
            )
        out["tournament_settled"] = True
    return out


async def _sync_fixtures_from_odds(db) -> dict:
    events = await sb._fetch_odds_api_h2h_events_merged(WC_SPORT_KEY)
    teams_by_id = await _teams_by_id(db)
    synced, skipped = 0, 0
    now = _now_iso()
    from utils.world_cup_fixtures import infer_knockout_round_from_kickoff, lookup_official_wc_fixture, resolve_wc_kickoff_utc

    for ev in events or []:
        ext_id = (ev.get("id") or "").strip()
        home_name = (ev.get("home_team") or "").strip()
        away_name = (ev.get("away_team") or "").strip()
        commence = ev.get("commence_time") or ev.get("start_time") or ""
        if not ext_id or not home_name or not away_name:
            skipped += 1
            continue
        home_id = await _resolve_team_id(db, home_name, teams_by_id)
        away_id = await _resolve_team_id(db, away_name, teams_by_id)
        if not home_id or not away_id:
            skipped += 1
            continue
        home_team = teams_by_id.get(home_id) or {}
        away_team = teams_by_id.get(away_id) or {}
        existing = await db.world_cup_matches.find_one({"external_event_id": ext_id}, {"_id": 0, "status": 1, "result": 1, "home_team_id": 1, "away_team_id": 1})
        if existing and existing.get("status") == "settled":
            h_old, a_old = existing.get("home_team_id"), existing.get("away_team_id")
            broken = not teams_by_id.get(h_old) or not teams_by_id.get(a_old)
            if broken and home_id and away_id:
                await db.world_cup_matches.update_one(
                    {"external_event_id": ext_id},
                    {"$set": {"home_team_id": home_id, "away_team_id": away_id, "updated_at": now}},
                )
            continue
        commence_parsed = sb._parse_commence_time(commence) if commence else None
        kickoff = resolve_wc_kickoff_utc(
            home_name,
            away_name,
            commence_parsed or (commence if isinstance(commence, str) else None),
        )
        if not kickoff:
            kickoff = commence_parsed or (commence if isinstance(commence, str) else _now_iso())

        official = lookup_official_wc_fixture(home_name, away_name)
        if official and official.get("kickoff_utc"):
            kickoff = official["kickoff_utc"]
        if official and official.get("group_id"):
            stage = "group"
            group_id = official["group_id"]
            knockout_round = None
        elif official and official.get("knockout_round"):
            stage = "knockout"
            group_id = None
            knockout_round = official["knockout_round"]
        else:
            g_home, g_away = home_team.get("group_id"), away_team.get("group_id")
            if g_home and g_home == g_away:
                stage = "group"
                group_id = g_home
                knockout_round = None
            else:
                stage = "knockout"
                group_id = None
                knockout_round = infer_knockout_round_from_kickoff(kickoff)
        doc = {
            "external_event_id": ext_id,
            "external_sport_key": WC_SPORT_KEY,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "kickoff": kickoff,
            "lock_at": _lock_at_from_kickoff(kickoff),
            "stage": stage,
            "group_id": group_id,
            "knockout_round": knockout_round,
            "status": "scheduled",
            "updated_at": now,
        }
        if existing:
            await db.world_cup_matches.update_one({"external_event_id": ext_id}, {"$set": doc})
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now
            await db.world_cup_matches.insert_one(doc)
        synced += 1
    reconciled = await _reconcile_wc_matches_from_official(db)
    seeded = await _ensure_official_knockout_fixtures(db)
    await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"last_fixture_sync_at": now}}, upsert=True)
    await _refresh_tournament_start_in_config(db)
    board_updated = 0
    try:
        board_updated = await sb._propagate_wc_kickoffs_to_open_board_events()
    except Exception as ex:
        logger.warning("wc kickoff propagate after fixture sync failed: %s", ex)
    return {
        "synced": synced,
        "skipped": skipped,
        "source_events": len(events or []),
        "board_kickoffs_updated": board_updated,
        "reconciled": reconciled,
        "official_knockout_seeded": seeded,
    }


async def _reconcile_wc_matches_from_official(db) -> int:
    """Fix stage / group / knockout_round / kickoff from FIFA schedule file (e.g. group J games on 28 Jun)."""
    from utils.world_cup_fixtures import lookup_official_wc_fixture

    teams_by_id = await _teams_by_id(db)
    updated = 0
    async for m in db.world_cup_matches.find({}, {"_id": 0, "id": 1, "status": 1, "home_team_id": 1, "away_team_id": 1}):
        if m.get("status") == "settled":
            continue
        ht = teams_by_id.get(m.get("home_team_id")) or {}
        at = teams_by_id.get(m.get("away_team_id")) or {}
        official = lookup_official_wc_fixture(ht.get("name") or "", at.get("name") or "")
        if not official:
            continue
        patch: dict = {}
        if official.get("group_id"):
            patch = {"stage": "group", "group_id": official["group_id"], "knockout_round": None}
        elif official.get("knockout_round"):
            patch = {"stage": "knockout", "group_id": None, "knockout_round": official["knockout_round"]}
        if official.get("kickoff_utc"):
            patch["kickoff"] = official["kickoff_utc"]
            patch["lock_at"] = _lock_at_from_kickoff(official["kickoff_utc"])
        if not patch:
            continue
        patch["updated_at"] = _now_iso()
        res = await db.world_cup_matches.update_one({"id": m["id"]}, {"$set": patch})
        updated += int(res.modified_count or 0)
    return updated


async def _ensure_official_knockout_fixtures(db) -> int:
    """Insert official Round of 32 (etc.) rows if Odds API did not provide them."""
    from utils.world_cup_fixtures import _official_fixture_rows, canonical_wc_team_name

    teams_by_id = await _teams_by_id(db)
    added = 0
    now = _now_iso()
    for row in _official_fixture_rows():
        if not row.get("knockout_round"):
            continue
        home_name = canonical_wc_team_name(row.get("home") or "")
        away_name = canonical_wc_team_name(row.get("away") or "")
        kickoff = (row.get("kickoff_utc") or "").strip()
        if not home_name or not away_name or not kickoff:
            continue
        home_id = await _resolve_team_id(db, home_name, teams_by_id)
        away_id = await _resolve_team_id(db, away_name, teams_by_id)
        if not home_id or not away_id:
            continue
        ext_key = f"official-wc26-{row.get('match_no') or kickoff}"
        existing = await db.world_cup_matches.find_one(
            {
                "$or": [
                    {"external_event_id": ext_key},
                    {"home_team_id": home_id, "away_team_id": away_id, "knockout_round": row.get("knockout_round")},
                ]
            },
            {"_id": 0, "id": 1, "status": 1},
        )
        doc = {
            "external_event_id": ext_key,
            "external_sport_key": WC_SPORT_KEY,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "kickoff": kickoff,
            "lock_at": _lock_at_from_kickoff(kickoff),
            "stage": "knockout",
            "group_id": None,
            "knockout_round": row.get("knockout_round"),
            "status": "scheduled",
            "updated_at": now,
        }
        if existing:
            if existing.get("status") == "settled":
                continue
            await db.world_cup_matches.update_one({"id": existing["id"]}, {"$set": doc})
            continue
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now
        await db.world_cup_matches.insert_one(doc)
        added += 1
    return added


async def _get_tournament_start_at(db, cfg: dict) -> Optional[datetime]:
    explicit = _parse_iso(cfg.get("tournament_start_at"))
    if explicit:
        return explicit
    cursor = db.world_cup_matches.find(
        {"kickoff": {"$exists": True, "$nin": [None, ""]}},
        {"kickoff": 1},
    ).sort("kickoff", 1).limit(1)
    docs = await cursor.to_list(1)
    if docs and docs[0].get("kickoff"):
        return _parse_iso(docs[0]["kickoff"])
    return None


def _is_tournament_started_at(start: Optional[datetime]) -> bool:
    if not start:
        return False
    return datetime.now(timezone.utc) >= start


async def _is_tournament_started(db, cfg: dict) -> bool:
    start = await _get_tournament_start_at(db, cfg)
    return _is_tournament_started_at(start)


async def _refresh_tournament_start_in_config(db) -> Optional[str]:
    cursor = db.world_cup_matches.find(
        {"kickoff": {"$exists": True, "$nin": [None, ""]}},
        {"kickoff": 1},
    ).sort("kickoff", 1).limit(1)
    docs = await cursor.to_list(1)
    if not docs or not docs[0].get("kickoff"):
        return None
    kickoff = docs[0]["kickoff"]
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"tournament_start_at": kickoff, "tournament_start_updated_at": _now_iso()}},
        upsert=True,
    )
    return kickoff


def _draft_timing_payload(cfg: dict, tournament_start: Optional[datetime]) -> dict:
    draft_at = None
    if tournament_start:
        draft_at = tournament_start - timedelta(hours=DRAFT_HOURS_BEFORE_START)
    return {
        "tournament_start_at": tournament_start.isoformat() if tournament_start else cfg.get("tournament_start_at"),
        "draft_scheduled_at": draft_at.isoformat() if draft_at else None,
        "draft_run_at": cfg.get("draft_run_at"),
        "draft_hours_before_start": DRAFT_HOURS_BEFORE_START,
    }


def _scores_from_api_event(api_ev: dict) -> tuple:
    scores = api_ev.get("scores") or []
    home_name = (api_ev.get("home_team") or "").strip()
    away_name = (api_ev.get("away_team") or "").strip()
    h_val, a_val = None, None
    for s in scores:
        n = (s.get("name") or "").strip()
        try:
            v = int(s.get("score"))
        except (TypeError, ValueError):
            continue
        if sb._team_matches_option(home_name, n) or _norm_name(n) == _norm_name(home_name):
            h_val = v
        elif sb._team_matches_option(away_name, n) or _norm_name(n) == _norm_name(away_name):
            a_val = v
    return h_val, a_val


async def _auto_settle_from_scores(db, send_notification) -> dict:
    delay_min = SETTLE_MINUTES_AFTER
    try:
        delay_min = int(os.environ.get("WORLD_CUP_AUTO_SETTLE_MINUTES_AFTER_START", str(SETTLE_MINUTES_AFTER)))
    except (TypeError, ValueError):
        delay_min = SETTLE_MINUTES_AFTER
    now = datetime.now(timezone.utc)
    cfg = await _load_config(db)
    cursor = db.world_cup_matches.find(
        {"status": {"$ne": "settled"}, "external_event_id": {"$exists": True, "$ne": ""}},
        {"_id": 0},
    )
    due_ids = []
    async for m in cursor:
        kick = _parse_iso(m.get("kickoff"))
        if kick and now >= kick + timedelta(minutes=delay_min):
            due_ids.append(m.get("external_event_id"))
    if not due_ids:
        return {"settled": 0, "message": "No due matches"}
    api_events = await sb._fetch_odds_api_scores(WC_SPORT_KEY, days_from=3)
    settled = 0
    for api_ev in api_events or []:
        if not api_ev.get("completed"):
            continue
        ext_id = (api_ev.get("id") or "").strip()
        if ext_id not in due_ids:
            continue
        h, a = _scores_from_api_event(api_ev)
        if h is None or a is None:
            continue
        match = await db.world_cup_matches.find_one({"external_event_id": ext_id}, {"_id": 0})
        if not match or match.get("status") == "settled":
            continue
        await _apply_match_result(db, send_notification, cfg, match["id"], h, a)
        settled += 1
    await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"last_auto_settle_at": _now_iso()}}, upsert=True)
    return {"settled": settled}


async def _run_draft_internal(db, send_notification=None) -> dict:
    cfg = await _load_config(db)
    if cfg.get("draft_run"):
        return {"ok": False, "error": "Draft already run"}
    entries = await db.world_cup_entries.find({}, {"_id": 0, "user_id": 1, "ghost_entry": 1}).to_list(5000)
    if not entries:
        return {"ok": False, "error": "No entrants"}
    real_entries = [e for e in entries if not e.get("ghost_entry")]
    if not real_entries:
        return {"ok": False, "error": "No real entrants (ghost-only)"}
    teams = await db.world_cup_teams.find({}, {"_id": 0, "id": 1}).to_list(100)
    team_ids = [t["id"] for t in teams if t.get("id")]
    if not team_ids:
        return {"ok": False, "error": "No teams seeded"}
    seed = random.randint(0, 2**31 - 1)
    rng = random.Random(seed)
    shuffled = list(team_ids)
    rng.shuffle(shuffled)
    n_all = len(entries)
    ghost_count = n_all - len(real_entries)
    assignments = {e["user_id"]: [] for e in entries}
    n_real = len(real_entries)
    for i, tid in enumerate(shuffled):
        uid = real_entries[i % n_real]["user_id"]
        assignments[uid].append(tid)
    for i, entry in enumerate(entries):
        if not entry.get("ghost_entry"):
            continue
        uid = entry["user_id"]
        assignments[uid] = [shuffled[j] for j in range(i, len(shuffled), n_all)]
    now = _now_iso()
    for uid, tids in assignments.items():
        await db.world_cup_entries.update_one(
            {"user_id": uid},
            {"$set": {"drafted_team_ids": tids, "draft_run_at": now}},
        )
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {
            "$set": {
                "draft_run": True,
                "draft_seed": seed,
                "draft_run_at": now,
                "entry_open": False,
                "draft_source_team_ids": team_ids,
            }
        },
        upsert=True,
    )
    if send_notification:
        await _notify_draft_assignments(db, send_notification, assignments, entries)
    real_counts = [len(assignments[e["user_id"]]) for e in real_entries]
    return {
        "ok": True,
        "entrants": n_all,
        "real_entrants": len(real_entries),
        "ghost_entrants": ghost_count,
        "teams": len(team_ids),
        "draft_seed": seed,
        "teams_per_user_min": min(real_counts) if real_counts else 0,
        "teams_per_user_max": max(real_counts) if real_counts else 0,
    }


async def _notify_draft_assignments(db, send_notification, assignments: dict, entries: list) -> None:
    ghost_ids = {e["user_id"] for e in entries if e.get("ghost_entry")}
    teams = await _teams_by_id(db)
    for uid, tids in assignments.items():
        if uid in ghost_ids or not tids:
            continue
        names = [teams[tid].get("name") or "?" for tid in tids if tid in teams]
        if not names:
            continue
        n = len(names)
        preview = ", ".join(names[:5])
        if n > 5:
            preview += f" (+{n - 5} more)"
        try:
            await send_notification(
                uid,
                "World Cup draft",
                f"Team draft complete — you were assigned {n} nation(s): {preview}.",
                "info",
                category="world_cup",
            )
        except Exception:
            pass


async def _run_draft(db, send_notification=None) -> dict:
    result = await _run_draft_internal(db, send_notification)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Draft failed")
    return {k: v for k, v in result.items() if k != "ok"}


async def _auto_run_draft_if_due(db, send_notification=None) -> dict:
    cfg = await _load_config(db)
    if not cfg.get("enabled"):
        return {"skipped": True, "reason": "disabled"}
    if cfg.get("draft_run"):
        return {"skipped": True, "reason": "already_run"}
    start = await _get_tournament_start_at(db, cfg)
    if not start:
        return {"skipped": True, "reason": "no_tournament_start"}
    draft_at = start - timedelta(hours=DRAFT_HOURS_BEFORE_START)
    now = datetime.now(timezone.utc)
    timing = _draft_timing_payload(cfg, start)
    if now < draft_at:
        return {"skipped": True, "reason": "not_due", **timing}
    result = await _run_draft_internal(db, send_notification)
    if not result.get("ok"):
        return {"skipped": True, "reason": result.get("error", "failed"), **timing, **result}
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"auto_draft_ran_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True, "auto": True, **timing, **{k: v for k, v in result.items() if k != "ok"}}


async def _build_draft_results(db) -> dict:
    cfg = await _load_config(db)
    start = await _get_tournament_start_at(db, cfg)
    timing = _draft_timing_payload(cfg, start)
    if not cfg.get("draft_run"):
        return {"draft_run": False, **timing, "assignments": []}
    teams = await _teams_by_id(db)
    entries = await db.world_cup_entries.find(
        {"ghost_entry": {"$ne": True}},
        {"_id": 0, "user_id": 1, "drafted_team_ids": 1, "entered_at": 1},
    ).sort("entered_at", 1).to_list(5000)
    user_ids = [e["user_id"] for e in entries if e.get("user_id")]
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    assignments = []
    team_total = 0
    for e in entries:
        uid = e.get("user_id")
        tids = e.get("drafted_team_ids") or []
        team_objs = [teams[tid] for tid in tids if tid in teams]
        team_total += len(team_objs)
        assignments.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "teams": team_objs,
            "team_count": len(team_objs),
        })
    assignments.sort(key=lambda x: (-x["team_count"], (x.get("username") or "").lower()))
    all_teams = await db.world_cup_teams.count_documents({})
    counts = [a["team_count"] for a in assignments]
    return {
        "draft_run": True,
        **timing,
        "real_entrants": len(assignments),
        "total_teams_distributed": team_total,
        "total_teams": all_teams,
        "teams_per_user_min": min(counts) if counts else 0,
        "teams_per_user_max": max(counts) if counts else 0,
        "assignments": assignments,
    }


def _playoff_slot_resolved(team: Optional[dict], resolution: dict) -> bool:
    if not team:
        return False
    return (
        (team.get("name") or "").strip() == resolution["name"]
        and (team.get("short_code") or "").strip().upper() == resolution["short_code"]
    )


async def _find_playoff_placeholder_team(db, placeholder_code: str) -> Optional[dict]:
    code = (placeholder_code or "").strip().upper()
    if code not in WC_PLAYOFF_RESOLUTIONS:
        return None
    resolution = WC_PLAYOFF_RESOLUTIONS[code]
    team = await db.world_cup_teams.find_one({"short_code": code}, {"_id": 0})
    if team:
        return team
    placeholder_name = WC_PLAYOFF_PLACEHOLDER_NAMES.get(code)
    if placeholder_name:
        team = await db.world_cup_teams.find_one({"name": placeholder_name}, {"_id": 0})
        if team:
            return team
    team = await db.world_cup_teams.find_one(
        {"group_id": resolution["group_id"], "short_code": resolution["short_code"]},
        {"_id": 0},
    )
    if team:
        return team
    async for row in db.world_cup_teams.find({"group_id": resolution["group_id"]}, {"_id": 0}):
        sc = (row.get("short_code") or "").strip().upper()
        if sc.startswith("PO-"):
            return row
    return None


async def _build_playoff_slots_status(db) -> List[dict]:
    rows = []
    for code in ("PO-A", "PO-B", "PO-C", "PO-D", "PO-E"):
        resolution = WC_PLAYOFF_RESOLUTIONS[code]
        team = await _find_playoff_placeholder_team(db, code)
        resolved = _playoff_slot_resolved(team, resolution) if team else False
        rows.append({
            "placeholder_code": code,
            "placeholder_name": WC_PLAYOFF_PLACEHOLDER_NAMES[code],
            "group_id": resolution["group_id"],
            "expected": {
                "name": resolution["name"],
                "short_code": resolution["short_code"],
            },
            "current": _team_brief(team) if team else None,
            "resolved": resolved,
            "missing": team is None,
        })
    return rows


async def _apply_playoff_resolution(db, placeholder_code: str, *, dry_run: bool = False) -> dict:
    code = (placeholder_code or "").strip().upper()
    if code not in WC_PLAYOFF_RESOLUTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown playoff slot {code!r}")
    resolution = WC_PLAYOFF_RESOLUTIONS[code]
    team = await _find_playoff_placeholder_team(db, code)
    if not team:
        return {
            "ok": False,
            "placeholder_code": code,
            "error": "placeholder_not_found",
            "message": f"No team row found for {WC_PLAYOFF_PLACEHOLDER_NAMES[code]} (group {resolution['group_id']})",
        }
    if _playoff_slot_resolved(team, resolution):
        return {
            "ok": True,
            "placeholder_code": code,
            "skipped": True,
            "team_id": team.get("id"),
            "before": _team_brief(team),
            "after": _team_brief(team),
            "message": f"{resolution['name']} already set",
        }
    before = _team_brief(team)
    update = {
        "name": resolution["name"],
        "short_code": resolution["short_code"],
        "flag_emoji": resolution.get("flag_emoji") or "",
        "odds_api_names": resolution.get("odds_api_names") or [],
        "playoff_resolved_at": _now_iso(),
        "playoff_placeholder_code": code,
    }
    if dry_run:
        after = {**team, **update}
        return {
            "ok": True,
            "dry_run": True,
            "placeholder_code": code,
            "team_id": team.get("id"),
            "before": before,
            "after": _team_brief(after),
            "message": f"Would set {before.get('name')} → {resolution['name']}",
        }
    await db.world_cup_teams.update_one({"id": team["id"]}, {"$set": update})
    after_doc = {**team, **update}
    return {
        "ok": True,
        "placeholder_code": code,
        "team_id": team.get("id"),
        "before": before,
        "after": _team_brief(after_doc),
        "message": f"Updated {before.get('name')} → {resolution['name']}",
    }


async def _apply_all_playoff_resolutions(db, *, dry_run: bool = False) -> dict:
    results = []
    updated = 0
    skipped = 0
    missing = 0
    for code in WC_PLAYOFF_RESOLUTIONS:
        row = await _apply_playoff_resolution(db, code, dry_run=dry_run)
        results.append(row)
        if not row.get("ok"):
            missing += 1
        elif row.get("skipped"):
            skipped += 1
        else:
            updated += 1
    return {
        "dry_run": dry_run,
        "updated": updated,
        "skipped": skipped,
        "missing": missing,
        "all_resolved": missing == 0 and updated == 0 and skipped == len(WC_PLAYOFF_RESOLUTIONS),
        "results": results,
        "message": (
            f"Resolved {updated} playoff slot(s)"
            if not dry_run
            else f"Would resolve {sum(1 for r in results if r.get('ok') and not r.get('skipped'))} slot(s)"
        ),
    }


async def _seed_2026(db, *, preserve_references: bool = True) -> dict:
    """
    Seed teams/groups from JSON. Uses stable wc26-{short_code} ids.
    When preserve_references=True (default), upserts in place and does not wipe entries/predictions.
    """
    data = _load_seed_teams_data()
    if preserve_references:
        result = await _ensure_stable_teams_from_seed(db)
        await db.game_config.update_one(
            {"id": CONFIG_ID},
            {
                "$setOnInsert": {"enabled": False, "ended_message": DEFAULT_ENDED_MESSAGE},
                "$set": {"seeded_at": _now_iso(), "phase": "upcoming"},
            },
            upsert=True,
        )
        return {
            "teams": result.get("teams_upserted", 0),
            "groups": result.get("groups_upserted", 0),
            "stable_ids": True,
            "preserved_references": True,
        }

    # Destructive legacy path — only when explicitly requested
    winner_by_group: Dict[str, str] = {}
    teams_by_id = await _teams_by_id(db)
    async for g in db.world_cup_groups.find({}, {"_id": 0, "group_id": 1, "winner_team_id": 1}):
        wid = g.get("winner_team_id")
        if not wid:
            continue
        team = teams_by_id.get(wid) or {}
        sc = (team.get("short_code") or "").strip().upper()
        if sc:
            winner_by_group[g["group_id"]] = _stable_wc_team_id(sc)

    await db.world_cup_teams.delete_many({})
    await db.world_cup_groups.delete_many({})
    teams_inserted = 0
    for grp in data.get("groups") or []:
        gid = grp.get("group_id")
        team_ids = []
        for t in grp.get("teams") or []:
            sc = (t.get("short_code") or "").strip().upper()
            tid = _stable_wc_team_id(sc) if sc else str(uuid.uuid4())
            doc = {
                "id": tid,
                "name": t.get("name"),
                "short_code": sc or t.get("short_code"),
                "flag_emoji": t.get("flag_emoji") or "",
                "group_id": gid,
                "odds_api_names": t.get("odds_api_names") or [],
            }
            await db.world_cup_teams.insert_one(doc)
            team_ids.append(tid)
            teams_inserted += 1
        grp_doc: dict = {"group_id": gid, "team_ids": team_ids}
        stable_winner = winner_by_group.get(gid)
        if stable_winner:
            grp_doc["winner_team_id"] = stable_winner
        await db.world_cup_groups.insert_one(grp_doc)
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {
            "$setOnInsert": {"enabled": False, "ended_message": DEFAULT_ENDED_MESSAGE},
            "$set": {"seeded_at": _now_iso(), "phase": "upcoming"},
        },
        upsert=True,
    )
    return {"teams": teams_inserted, "groups": len(data.get("groups") or []), "stable_ids": True, "preserved_references": False}


def _summarize_user_predictions(preds: list, teams_by_id: dict) -> dict:
    stats = {
        "total": len(preds),
        "open": 0,
        "won": 0,
        "lost": 0,
        "pending_payout": 0,
        "points_paid": 0,
        "points_pending": 0,
    }
    group_picks = {}
    second_place = None
    third_place = None
    for p in preds:
        pts = int(p.get("points_awarded") or 0)
        if not p.get("settled"):
            stats["open"] += 1
        elif pts > 0:
            stats["won"] += 1
            if p.get("payout_status") == "pending":
                stats["pending_payout"] += 1
                stats["points_pending"] += pts
            elif p.get("payout_status") == "paid":
                stats["points_paid"] += pts
            elif p.get("payout_status") != "ghost":
                stats["points_paid"] += pts
        else:
            stats["lost"] += 1
        ptype = p.get("type")
        val = p.get("value") or {}
        if ptype == PRED_GROUP_WINNER:
            tid = val.get("team_id") if isinstance(val, dict) else val
            group_picks[p.get("target_id") or "?"] = _prediction_team_label(val, teams_by_id, tid)
        elif ptype == PRED_SECOND_PLACE:
            tid = val.get("team_id") if isinstance(val, dict) else val
            second_place = _prediction_team_label(val, teams_by_id, tid)
        elif ptype == PRED_THIRD_PLACE:
            tid = val.get("team_id") if isinstance(val, dict) else val
            third_place = _prediction_team_label(val, teams_by_id, tid)
    return {
        **stats,
        "group_picks": group_picks,
        "second_place": second_place,
        "third_place": third_place,
    }


async def _build_admin_leaderboard(db, cfg: dict, ghost_ids: set, limit: int = 100) -> list:
    pts_cfg = _points_from_config(cfg)
    jackpot_pts = pts_cfg["jackpot_points"]
    ghost_list = list(ghost_ids) if ghost_ids else []
    match_filter = {"settled": True, "points_awarded": {"$gt": 0}}
    if ghost_list:
        match_filter["user_id"] = {"$nin": ghost_list}
    pipeline = [
        {"$match": match_filter},
        {
            "$group": {
                "_id": "$user_id",
                "points_paid": {
                    "$sum": {"$cond": [{"$ne": ["$payout_status", "pending"]}, "$points_awarded", 0]}
                },
                "points_pending": {
                    "$sum": {"$cond": [{"$eq": ["$payout_status", "pending"]}, "$points_awarded", 0]}
                },
                "wins": {"$sum": 1},
            }
        },
        {"$sort": {"points_paid": -1, "points_pending": -1}},
        {"$limit": int(limit) * 2},
    ]
    totals: Dict[str, dict] = {}
    async for doc in db.world_cup_predictions.aggregate(pipeline):
        uid = doc.get("_id")
        if not uid:
            continue
        totals[uid] = {
            "points_paid": int(doc.get("points_paid") or 0),
            "points_pending": int(doc.get("points_pending") or 0),
            "wins": int(doc.get("wins") or 0),
        }
    async for e in db.world_cup_entries.find(
        {"ghost_entry": {"$ne": True}, "$or": [{"jackpot_awarded": True}, {"jackpot_pending": True}]},
        {"_id": 0, "user_id": 1, "jackpot_pending": 1, "jackpot_awarded": 1},
    ):
        uid = e.get("user_id")
        if not uid:
            continue
        row = totals.setdefault(uid, {"points_paid": 0, "points_pending": 0, "wins": 0})
        if e.get("jackpot_pending"):
            row["points_pending"] += jackpot_pts
            row["wins"] += 1
        elif e.get("jackpot_awarded"):
            row["points_paid"] += jackpot_pts
            row["wins"] += 1
    if not totals:
        return []
    user_ids = list(totals.keys())
    usernames = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
        usernames[u["id"]] = u.get("username") or "?"
    rows = []
    for uid, t in totals.items():
        paid = int(t["points_paid"])
        pending = int(t["points_pending"])
        rows.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "points_paid": paid,
            "points_pending": pending,
            "points_total": paid + pending,
            "wins": int(t["wins"]),
        })
    rows.sort(key=lambda x: (-x["points_total"], -x["points_paid"], x["username"].lower()))
    for i, row in enumerate(rows[:limit]):
        row["rank"] = i + 1
    return rows[:limit]


async def _build_admin_overview(db, username: Optional[str] = None, limit: int = 500) -> dict:
    await _ensure_orphan_team_ids_healed(db)
    cfg = await _load_config(db)
    teams_by_id = await _teams_by_id_resolved(db)
    ghost_ids = await _ghost_user_ids(db)
    start = await _get_tournament_start_at(db, cfg)
    tournament_started = _is_tournament_started_at(start)
    q: dict = {}
    if username and username.strip():
        uname = username.strip()
        user_ids = []
        async for u in db.users.find(
            {"username": {"$regex": re.escape(uname), "$options": "i"}},
            {"_id": 0, "id": 1},
        ).limit(50):
            if u.get("id"):
                user_ids.append(u["id"])
        if not user_ids:
            return {
                "summary": {},
                "entrants": [],
                "leaderboard": [],
                "tournament": {},
                "total_shown": 0,
            }
        q["user_id"] = {"$in": user_ids}
    lim = max(1, min(int(limit), 2000))
    entries = await db.world_cup_entries.find(q, {"_id": 0}).sort("entered_at", 1).limit(lim).to_list(lim)
    user_ids = [e.get("user_id") for e in entries if e.get("user_id")]
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    preds_by_user: Dict[str, list] = {uid: [] for uid in user_ids}
    if user_ids:
        async for p in db.world_cup_predictions.find({"user_id": {"$in": user_ids}}, {"_id": 0}):
            uid = p.get("user_id")
            if uid in preds_by_user:
                preds_by_user[uid].append(p)
    global_stats = await _prediction_global_stats(db)
    entry_stats = await _entry_counts(db)
    pending_counts = await _pending_payout_counts(db)
    entrants_out = []
    for e in entries:
        uid = e.get("user_id")
        tids = e.get("drafted_team_ids") or []
        drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
        pred_summary = _summarize_user_predictions(preds_by_user.get(uid) or [], teams_by_id)
        jackpot_pts = _points_from_config(cfg)["jackpot_points"]
        if e.get("jackpot_pending"):
            pred_summary["pending_payout"] += 1
            pred_summary["points_pending"] += jackpot_pts
        elif e.get("jackpot_awarded"):
            pred_summary["points_paid"] += jackpot_pts
            pred_summary["won"] += 1
        entrants_out.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "ghost_entry": bool(e.get("ghost_entry")),
            "entered_at": e.get("entered_at"),
            "drafted_teams": drafted,
            "drafted_team_names": [t.get("name") for t in drafted if t.get("name")],
            "drafted_team_count": len(drafted),
            "jackpot_pending": bool(e.get("jackpot_pending")),
            "jackpot_awarded": bool(e.get("jackpot_awarded")),
            "predictions": pred_summary,
        })
    entrants_out.sort(key=lambda x: (-(x["predictions"].get("points_paid", 0) + x["predictions"].get("points_pending", 0)), x.get("username") or ""))
    champion_id = cfg.get("champion_team_id")
    runner_id = cfg.get("runner_up_team_id")
    third_id = cfg.get("third_place_team_id")
    return {
        "summary": {
            **entry_stats,
            "draft_run": bool(cfg.get("draft_run")),
            "tournament_started": tournament_started,
            "predictions_total": (
                global_stats["predictions_open"]
                + global_stats["predictions_won"]
                + global_stats["predictions_lost"]
            ),
            **global_stats,
            **pending_counts,
        },
        "tournament": {
            "tournament_start_at": start.isoformat() if start else cfg.get("tournament_start_at"),
            "tournament_started": tournament_started,
            "champion": _team_brief(teams_by_id.get(champion_id or "")),
            "runner_up": _team_brief(teams_by_id.get(runner_id or "")),
            "third_place": _team_brief(teams_by_id.get(third_id or "")),
            "phase": cfg.get("phase") or "upcoming",
        },
        "leaderboard": await _build_admin_leaderboard(db, cfg, ghost_ids, 100),
        "entrants": entrants_out,
        "total_shown": len(entrants_out),
    }


async def _build_admin_user_detail(db, user_id: str) -> dict:
    cfg = await _load_config(db)
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="User not entered")
    teams_by_id = await _teams_by_id_resolved(db)
    matches_by_id = {}
    async for m in db.world_cup_matches.find({}, {"_id": 0}):
        mid = m.get("id")
        if mid:
            matches_by_id[mid] = m
    groups_by_id = {}
    async for g in db.world_cup_groups.find({}, {"_id": 0}):
        gid = g.get("group_id")
        if gid:
            groups_by_id[gid] = g
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
    usernames = {user_id: (u or {}).get("username") or "?"}
    entries_by_user = {user_id: entry}
    preds = await db.world_cup_predictions.find({"user_id": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    enriched = [
        _enrich_prediction_for_staff(p, teams_by_id, matches_by_id, groups_by_id, usernames, entries_by_user, cfg)
        for p in preds
    ]
    tids = entry.get("drafted_team_ids") or []
    drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
    summary = _summarize_user_predictions(preds, teams_by_id)
    return {
        "user_id": user_id,
        "username": usernames.get(user_id, "?"),
        "ghost_entry": bool(entry.get("ghost_entry")),
        "entered_at": entry.get("entered_at"),
        "drafted_teams": drafted,
        "jackpot_pending": bool(entry.get("jackpot_pending")),
        "jackpot_awarded": bool(entry.get("jackpot_awarded")),
        "predictions_summary": summary,
        "predictions": enriched,
    }


class WorldCupPredictionBody(BaseModel):
    type: str = Field(..., min_length=2)
    target_id: str = Field(..., min_length=1)
    value: Any = None


class WorldCupConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    entry_open: Optional[bool] = None
    ended_message: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    banner_text: Optional[str] = None
    phase: Optional[str] = None
    tournament_start_at: Optional[str] = None
    group_winner_points: Optional[int] = None
    jackpot_points: Optional[int] = None
    second_place_points: Optional[int] = None
    third_place_points: Optional[int] = None
    match_score_exact_points: Optional[int] = None
    match_score_result_points: Optional[int] = None
    match_scorer_points: Optional[int] = None


class MatchResultPatch(BaseModel):
    home_score: int = Field(..., ge=0, le=30)
    away_score: int = Field(..., ge=0, le=30)
    scorers: Optional[List[str]] = None
    stage: Optional[str] = None
    auto_approve: bool = False


class BulkMatchImport(BaseModel):
    matches: List[dict] = Field(default_factory=list)


class WorldCupPlayoffResolveBody(BaseModel):
    dry_run: bool = False


class GroupWinnerSetBody(BaseModel):
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    force: bool = False


class GroupWinnersBulkBody(BaseModel):
    winners: Dict[str, str] = Field(default_factory=dict)
    force: bool = False
    auto_approve: bool = False


class SettleGroupsPayBody(BaseModel):
    auto_approve: bool = True


class GroupPicksRestoreBody(BaseModel):
    username: str
    picks: Optional[Dict[str, str]] = None
    picks_text: Optional[str] = None
    re_settle: bool = True
    create_missing: bool = True
    auto_approve: bool = False


class GroupPicksPreviewBody(BaseModel):
    username: str
    picks: Optional[Dict[str, str]] = None
    picks_text: Optional[str] = None


class GroupPayoutPayBody(BaseModel):
    dry_run: bool = False


class GroupPayoutManualPaidBody(BaseModel):
    prediction_ids: List[str] = Field(default_factory=list)


class AutoRestoreGroupPicksBody(BaseModel):
    re_settle: bool = True
    dry_run: bool = False


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    send_notification = srv.send_notification
    _is_entertainer = srv._is_entertainer
    _is_admin = srv._is_admin
    require_admin = srv.require_admin

    async def _wc_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_WORLD_CUP)

    _wc_rl = [Depends(_wc_rl_user)]

    @router.get("/world-cup/public-status")
    async def world_cup_public_status():
        cfg = await _load_config(db)
        return {
            "enabled": bool(cfg.get("enabled")),
            "ended_message": cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE,
            "phase": cfg.get("phase") or "upcoming",
            "banner_text": (cfg.get("banner_text") or "").strip(),
        }

    @router.get("/world-cup/status", dependencies=_wc_rl)
    async def world_cup_status(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        uid = current_user.get("id") or ""
        if not cfg.get("enabled"):
            return {"enabled": False, "ended_message": cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE}
        entry = await db.world_cup_entries.find_one({"user_id": uid}, {"_id": 0}) if uid else None
        group_locks = await _group_lock_times(db)
        pending_payouts = 0
        if uid:
            pending_payouts = await db.world_cup_predictions.count_documents({"user_id": uid, "payout_status": "pending"})
            if entry and entry.get("jackpot_pending"):
                pending_payouts += 1
        drafted = []
        if entry and entry.get("drafted_team_ids"):
            tids = [t for t in entry["drafted_team_ids"] if t]
            if tids:
                drafted = await db.world_cup_teams.find(
                    {"id": {"$in": tids}},
                    {"_id": 0},
                ).to_list(len(tids))
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        tournament_started = _is_tournament_started_at(start)
        can_enter = _can_enter_event(cfg, entry)
        earnings = await _user_wc_earnings(db, uid, cfg, entry) if uid and entry and not (entry.get("ghost_entry")) else None
        return {
            "enabled": True,
            "config": {k: cfg.get(k) for k in list(DEFAULT_POINTS.keys()) + ["entry_open", "draft_run", "phase", "banner_text"]},
            "points": _points_from_config(cfg),
            "entered": bool(entry),
            "can_enter": can_enter,
            "late_entry_available": can_enter and _late_entry_only(cfg),
            "ghost_entry": bool(entry and entry.get("ghost_entry")),
            "can_ghost_enter": bool(
                _is_admin(current_user)
                and not entry
                and cfg.get("entry_open", True)
                and not cfg.get("draft_run")
            ),
            "entry": entry,
            "drafted_teams": drafted,
            "group_locks": group_locks,
            "tournament_started": tournament_started,
            "tournament_picks_locked": tournament_started,
            "teams_count": await db.world_cup_teams.count_documents({}),
            "pending_payouts": pending_payouts,
            "earnings": earnings,
            **draft_timing,
        }

    @router.get("/world-cup/draft-results", dependencies=_wc_rl)
    async def world_cup_draft_results(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        return await _build_draft_results(db)

    @router.get("/world-cup/teams", dependencies=_wc_rl)
    async def world_cup_teams(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        teams = await db.world_cup_teams.find({}, {"_id": 0}).sort([("group_id", 1), ("name", 1)]).to_list(100)
        groups = await db.world_cup_groups.find({}, {"_id": 0}).sort("group_id", 1).to_list(20)
        return {"teams": teams, "groups": groups}

    @router.get("/world-cup/matches", dependencies=_wc_rl)
    async def world_cup_matches_list(
        stage: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        q = {}
        if stage:
            q["stage"] = stage
        matches = await db.world_cup_matches.find(q, {"_id": 0}).sort("kickoff", 1).to_list(500)
        teams = await _teams_by_id(db)
        from utils.world_cup_fixtures import enrich_wc_match_round, knockout_round_sort_key

        out = []
        for m in matches:
            row = dict(m)
            ht = teams.get(m.get("home_team_id"))
            at = teams.get(m.get("away_team_id"))
            if not ht or not at:
                from utils.world_cup_fixtures import team_briefs_from_official_schedule

                sh, sa = team_briefs_from_official_schedule(m, teams)
                if not ht and sh:
                    ht = sh
                if not at and sa:
                    at = sa
            row["home_team"] = ht
            row["away_team"] = at
            row["locked"] = _is_locked(m.get("lock_at"))
            row = enrich_wc_match_round(row)
            out.append(row)
        knockout_rounds = sorted(
            {r.get("round_key") for r in out if r.get("is_knockout") and r.get("round_key")},
            key=knockout_round_sort_key,
        )
        return {"matches": out, "knockout_rounds": knockout_rounds}

    @router.get("/world-cup/my-predictions", dependencies=_wc_rl)
    async def world_cup_my_predictions(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        entry = await db.world_cup_entries.find_one({"user_id": uid}, {"_id": 0}) if uid else None
        preds = await db.world_cup_predictions.find({"user_id": uid}, {"_id": 0}).to_list(500)
        earnings = None
        if uid and entry and not entry.get("ghost_entry"):
            earnings = await _user_wc_earnings(db, uid, cfg, entry)
        return {"predictions": preds, "earnings": earnings}

    @router.get("/world-cup/leaderboard", dependencies=_wc_rl)
    async def world_cup_leaderboard(limit: int = Query(50, ge=1, le=100), current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        pipeline = [
            {
                "$match": {
                    "settled": True,
                    "points_awarded": {"$gt": 0},
                    "$or": [
                        {"payout_status": "paid"},
                        {"payout_status": {"$exists": False}},
                    ],
                }
            },
            {"$group": {"_id": "$user_id", "total": {"$sum": "$points_awarded"}}},
            {"$sort": {"total": -1}},
            {"$limit": int(limit)},
        ]
        rows = await db.world_cup_predictions.aggregate(pipeline).to_list(int(limit))
        ghost_ids = await _ghost_user_ids(db)
        jackpot_rows = await db.world_cup_entries.find(
            {"jackpot_awarded": True, "jackpot_pending": {"$ne": True}, "ghost_entry": {"$ne": True}},
            {"_id": 0, "user_id": 1},
        ).to_list(5000)
        totals = {}
        for r in rows:
            row_uid = r["_id"]
            if row_uid in ghost_ids:
                continue
            totals[row_uid] = int(r["total"])
        for e in jackpot_rows:
            uid_j = e.get("user_id")
            if uid_j and uid_j not in ghost_ids:
                totals[uid_j] = totals.get(uid_j, 0) + _points_from_config(cfg)["jackpot_points"]
        sorted_users = sorted(totals.items(), key=lambda x: x[1], reverse=True)[: int(limit)]
        usernames = {}
        if sorted_users:
            ids = [u for u, _ in sorted_users]
            async for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}):
                usernames[u["id"]] = u.get("username") or "?"
        board = []
        my_rank = None
        for i, (user_id, total) in enumerate(sorted_users):
            rank = i + 1
            board.append({"rank": rank, "user_id": user_id, "username": usernames.get(user_id, "?"), "points": total})
            if user_id == uid:
                my_rank = rank
        my_total = totals.get(uid, 0)
        if uid in ghost_ids:
            my_rank = None
            my_total = 0
        elif uid and my_rank is None and my_total > 0:
            my_rank = len(sorted_users) + 1
        return {"leaderboard": board, "my_rank": my_rank, "my_points": my_total, "ghost_entry": uid in ghost_ids}

    @router.post("/world-cup/enter")
    async def world_cup_enter(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        existing = await db.world_cup_entries.find_one({"user_id": uid})
        if existing:
            return {"ok": True, "already_entered": True}
        if not _can_enter_event(cfg, None):
            raise HTTPException(status_code=400, detail="Entry is closed")
        late = _late_entry_only(cfg)
        doc = {"user_id": uid, "entered_at": _now_iso(), "drafted_team_ids": []}
        if late:
            doc["late_entry"] = True
        await db.world_cup_entries.insert_one(doc)
        return {"ok": True, "late_entry": late}

    @router.post("/world-cup/enter-ghost")
    async def world_cup_enter_ghost(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        if not cfg.get("entry_open", True):
            raise HTTPException(status_code=400, detail="Entry is closed")
        if cfg.get("draft_run"):
            raise HTTPException(status_code=400, detail="Draft already run")
        uid = current_user.get("id") or ""
        existing = await db.world_cup_entries.find_one({"user_id": uid})
        if existing:
            if existing.get("ghost_entry"):
                return {"ok": True, "already_entered": True, "ghost_entry": True}
            raise HTTPException(status_code=400, detail="Already entered as a real player")
        await db.world_cup_entries.insert_one({
            "user_id": uid,
            "entered_at": _now_iso(),
            "drafted_team_ids": [],
            "ghost_entry": True,
        })
        return {"ok": True, "ghost_entry": True}

    @router.post("/world-cup/predictions")
    async def world_cup_save_prediction(body: WorldCupPredictionBody, current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        entry = await db.world_cup_entries.find_one({"user_id": uid})
        if not entry:
            raise HTTPException(status_code=400, detail="Enter the event first")
        ptype = (body.type or "").strip()
        target = (body.target_id or "").strip()
        if ptype not in (PRED_GROUP_WINNER, PRED_MATCH_SCORE, PRED_MATCH_SCORER, PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            raise HTTPException(status_code=400, detail="Invalid prediction type")
        lookup_target = "tournament" if ptype in (PRED_SECOND_PLACE, PRED_THIRD_PLACE) else target
        existing = await db.world_cup_predictions.find_one(
            {"user_id": uid, "type": ptype, "target_id": lookup_target},
        )
        if ptype == PRED_GROUP_WINNER:
            if target not in GROUP_IDS:
                raise HTTPException(status_code=400, detail="Invalid group")
            if await _is_tournament_started(db, cfg):
                raise HTTPException(status_code=400, detail="Tournament has started — group picks are locked")
            locks = await _group_lock_times(db)
            if _is_locked(locks.get(target)):
                raise HTTPException(status_code=400, detail=f"Group {target} is locked")
            team_id = body.value.get("team_id") if isinstance(body.value, dict) else body.value
            if not team_id:
                raise HTTPException(status_code=400, detail="team_id required")
            t = await db.world_cup_teams.find_one({"id": team_id, "group_id": target})
            if not t:
                raise HTTPException(status_code=400, detail="Team not in group")
            prior_val = {}
            if existing and isinstance(existing.get("value"), dict):
                prior_val = existing["value"]
            body.value = {
                **(body.value if isinstance(body.value, dict) else {}),
                "team_id": team_id,
                "team_name": t.get("name"),
                "short_code": t.get("short_code"),
                "original_team_id": prior_val.get("original_team_id") or team_id,
            }
            await _wc_upsert_group_pick_snapshot(db, uid, target, body.value, source="save")
        elif ptype in (PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            if await _is_tournament_started(db, cfg):
                raise HTTPException(status_code=400, detail="Tournament has started — picks are locked")
            team_id = body.value.get("team_id") if isinstance(body.value, dict) else body.value
            if not team_id or not await db.world_cup_teams.find_one({"id": team_id}):
                raise HTTPException(status_code=400, detail="Invalid team")
            t = await db.world_cup_teams.find_one({"id": team_id}, {"_id": 0, "name": 1, "short_code": 1})
            body.value = {
                **(body.value if isinstance(body.value, dict) else {}),
                "team_id": team_id,
                "team_name": (t or {}).get("name"),
                "short_code": (t or {}).get("short_code"),
            }
            target = "tournament"
        elif ptype == PRED_MATCH_SCORE:
            match = await db.world_cup_matches.find_one({"id": target}, {"_id": 0})
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")
            if _is_locked(match.get("lock_at")):
                raise HTTPException(status_code=400, detail="Match is locked")
            val = body.value if isinstance(body.value, dict) else {}
            try:
                h, a = int(val.get("home")), int(val.get("away"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="home and away scores required")
            if h < 0 or a < 0 or h > 20 or a > 20:
                raise HTTPException(status_code=400, detail="Invalid score")
            body.value = {"home": h, "away": a}
        elif ptype == PRED_MATCH_SCORER:
            match = await db.world_cup_matches.find_one({"id": target}, {"_id": 0})
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")
            if _is_locked(match.get("lock_at")):
                raise HTTPException(status_code=400, detail="Match is locked")
            name = (body.value.get("name") if isinstance(body.value, dict) else str(body.value or "")).strip()
            if not name:
                raise HTTPException(status_code=400, detail="Scorer name required")
            body.value = {"name": name[:80]}
        now = _now_iso()
        if existing:
            if existing.get("settled"):
                raise HTTPException(status_code=400, detail="Prediction already settled")
            await db.world_cup_predictions.update_one(
                {"id": existing["id"]},
                {"$set": {"value": body.value, "updated_at": now}},
            )
            return {"ok": True, "id": existing["id"]}
        pid = str(uuid.uuid4())
        await db.world_cup_predictions.insert_one(
            {
                "id": pid,
                "user_id": uid,
                "type": ptype,
                "target_id": target,
                "value": body.value,
                "settled": False,
                "points_awarded": 0,
                "created_at": now,
                "updated_at": now,
            }
        )
        return {"ok": True, "id": pid}

    # --- Staff ---
    def _require_ent(current_user: dict):
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")

    def _require_staff(current_user: dict):
        if not _is_entertainer(current_user) and not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Staff access required")

    @router.get("/world-cup/staff/dashboard")
    async def wc_staff_dashboard(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        entrants = await db.world_cup_entries.count_documents({})
        real_entrants = await db.world_cup_entries.count_documents({"ghost_entry": {"$ne": True}})
        ghost_entrants = await db.world_cup_entries.count_documents({"ghost_entry": True})
        unsettled = await db.world_cup_matches.count_documents({"status": {"$ne": "settled"}})
        pending = await _pending_payout_counts(db)
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        matches = await _build_staff_match_picker(db)
        return {
            "entrants": entrants,
            "real_entrants": real_entrants,
            "ghost_entrants": ghost_entrants,
            "unsettled_matches": unsettled,
            "matches": matches,
            "draft_run": bool(cfg.get("draft_run")),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
            **pending,
            **draft_timing,
        }

    @router.post("/world-cup/staff/run-draft")
    async def wc_staff_run_draft(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _run_draft(db, send_notification)

    @router.patch("/world-cup/staff/match/{match_id}/result")
    async def wc_staff_patch_result(match_id: str, body: MatchResultPatch, current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        if body.stage:
            await db.world_cup_matches.update_one({"id": match_id}, {"$set": {"stage": body.stage.strip().lower()}})
        out = await _apply_match_result(db, send_notification, cfg, match_id, body.home_score, body.away_score, body.scorers)
        if body.auto_approve:
            payout = await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")
            out["payout"] = payout
        return out

    @router.post("/world-cup/staff/settle-match/{match_id}")
    async def wc_staff_settle_match(match_id: str, current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        match = await db.world_cup_matches.find_one({"id": match_id}, {"_id": 0})
        if not match or not match.get("result"):
            raise HTTPException(status_code=400, detail="Match needs result first")
        res = match["result"]
        return await _apply_match_result(db, send_notification, cfg, match_id, int(res["home_score"]), int(res["away_score"]), res.get("scorers"))

    @router.post("/world-cup/staff/settle-groups")
    async def wc_staff_settle_groups(group_id: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        if group_id:
            gid = group_id.strip().upper()
            ok = await _try_settle_group(db, send_notification, cfg, gid)
            return {"groups_settled": 1 if ok else 0, "details": [{"group_id": gid, "settled": ok}]}
        return await _settle_all_groups_comprehensive(db, send_notification, cfg)

    @router.get("/world-cup/staff/groups-setup")
    async def wc_staff_groups_setup(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _build_groups_setup(db)

    @router.post("/world-cup/staff/group/{group_id}/winner")
    async def wc_staff_set_group_winner(
        group_id: str,
        body: GroupWinnerSetBody,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        team = await _resolve_winner_team_in_group(
            db, group_id, team_id=body.team_id, team_name=body.team_name
        )
        return await _set_group_winner_manual(
            db,
            send_notification,
            cfg,
            group_id,
            team["id"],
            force=bool(body.force),
        )

    @router.post("/world-cup/staff/group-winners/bulk")
    async def wc_staff_set_group_winners_bulk(
        body: GroupWinnersBulkBody,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        results = []
        total_preds = 0
        for raw_gid, pick in (body.winners or {}).items():
            if not pick or not str(pick).strip():
                continue
            gid = str(raw_gid).strip().upper()
            team = await _resolve_winner_pick_in_group(db, gid, str(pick))
            row = await _set_group_winner_manual(
                db, send_notification, cfg, gid, team["id"], force=bool(body.force)
            )
            total_preds += int(row.get("predictions_settled") or 0)
            results.append(row)
        payout = None
        if body.auto_approve and results:
            payout = await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")
        return {
            "groups_updated": len(results),
            "predictions_settled": total_preds,
            "results": results,
            "payout": payout,
        }

    @router.post("/world-cup/staff/settle-groups-and-pay")
    async def wc_staff_settle_groups_and_pay(
        body: SettleGroupsPayBody,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        settled = await _settle_all_groups_comprehensive(db, send_notification, cfg)
        payout = None
        if body.auto_approve:
            payout = await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")
        return {**settled, "payout": payout}

    @router.post("/world-cup/staff/settle-tournament")
    async def wc_staff_settle_tournament(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        champion = cfg.get("champion_team_id")
        if not champion:
            raise HTTPException(status_code=400, detail="Champion not set — settle final match first")
        return {"ok": True, "champion_team_id": champion}

    @router.get("/world-cup/staff/entries")
    async def wc_staff_entries(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        entries = await db.world_cup_entries.find({}, {"_id": 0}).limit(int(limit)).to_list(int(limit))
        user_ids = [e.get("user_id") for e in entries if e.get("user_id")]
        usernames = {}
        if user_ids:
            async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
                usernames[u["id"]] = u.get("username") or "?"
        for e in entries:
            e["username"] = usernames.get(e.get("user_id"), "?")
        return {"entries": entries}

    @router.get("/world-cup/staff/predictions")
    async def wc_staff_predictions(
        limit: int = Query(500, ge=1, le=2000),
        type: Optional[str] = Query(None, alias="type"),
        match_id: Optional[str] = Query(None),
        group_id: Optional[str] = Query(None),
        username: Optional[str] = Query(None),
        settled: Optional[bool] = Query(None),
        payout_status: Optional[str] = Query(None),
        verdict: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        if type and type not in (PRED_GROUP_WINNER, PRED_MATCH_SCORE, PRED_MATCH_SCORER, PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            raise HTTPException(status_code=400, detail="Invalid prediction type filter")
        if verdict and verdict not in ("pending", "correct", "result_correct", "incorrect"):
            raise HTTPException(status_code=400, detail="Invalid verdict filter")
        return await _build_staff_predictions_feed(
            db, limit, type, match_id, group_id, username, settled, payout_status, verdict
        )

    @router.get("/world-cup/staff/pending-payouts")
    async def wc_staff_pending_payouts(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _list_pending_payouts(db, limit)

    @router.post("/world-cup/staff/approve-payout/{prediction_id}")
    async def wc_staff_approve_payout(prediction_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_prediction_payout(db, send_notification, prediction_id, current_user.get("id") or "")

    @router.post("/world-cup/staff/approve-jackpot/{user_id}")
    async def wc_staff_approve_jackpot(user_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_jackpot_payout(db, send_notification, user_id, current_user.get("id") or "")

    @router.post("/world-cup/staff/approve-all-payouts")
    async def wc_staff_approve_all_payouts(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")

    @router.post("/world-cup/staff/restore-group-winners")
    async def wc_staff_restore_group_winners(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        healed = await _ensure_orphan_team_ids_healed(db)
        old_to_new = await _build_comprehensive_old_team_map(db)
        stable_id_set = set(_seed_file_team_ids_in_order())
        restored = await _restore_group_winners(db, old_to_new, stable_id_set)
        return {"healed": healed, **restored}

    @router.post("/world-cup/staff/preview-user-group-picks")
    async def wc_staff_preview_user_group_picks(
        body: GroupPicksPreviewBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Preview pasted forum/Discord group-winner picks vs settled winners."""
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _preview_user_group_picks_from_text(
            db,
            username=body.username,
            picks=body.picks,
            picks_text=body.picks_text,
        )

    @router.get("/world-cup/staff/group-payouts/report")
    async def wc_staff_group_payouts_report(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _build_group_winner_payout_report(db)

    @router.post("/world-cup/staff/group-payouts/pay")
    async def wc_staff_group_payouts_pay(
        body: GroupPayoutPayBody,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _pay_pending_group_winner_payouts(
            db,
            send_notification,
            current_user.get("id") or "",
            dry_run=bool(body.dry_run),
        )

    @router.post("/world-cup/staff/group-payouts/mark-manual-paid")
    async def wc_staff_group_payouts_mark_manual_paid(
        body: GroupPayoutManualPaidBody,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _mark_group_winner_payouts_manually_paid(
            db,
            current_user.get("id") or "",
            body.prediction_ids,
        )

    @router.post("/world-cup/staff/restore-user-group-picks")
    async def wc_staff_restore_user_group_picks(
        body: GroupPicksRestoreBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Fix corrupted group-winner picks from Discord-style text or a picks map."""
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _staff_restore_user_group_picks(
            db,
            send_notification,
            username=body.username,
            picks=body.picks,
            picks_text=body.picks_text,
            re_settle=bool(body.re_settle),
            create_missing=bool(body.create_missing),
            auto_approve=bool(body.auto_approve),
            approver_id=current_user.get("id") or "",
        )

    @router.post("/world-cup/staff/auto-restore-group-picks")
    async def wc_staff_auto_restore_group_picks(
        body: AutoRestoreGroupPicksBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Restore all players' group-winner picks from snapshots, stored names, and chat logs."""
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _auto_restore_all_group_picks(
            db,
            send_notification,
            re_settle=bool(body.re_settle),
            dry_run=bool(body.dry_run),
        )

    @router.post("/world-cup/staff/repair-references")
    async def wc_staff_repair_references(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _repair_wc_team_references(db)

    # --- Admin ---
    @router.post("/admin/world-cup/seed-2026")
    async def admin_wc_seed(current_user: dict = Depends(require_admin)):
        return await _seed_2026(db)

    @router.post("/admin/world-cup/repair-references")
    async def admin_wc_repair_references(current_user: dict = Depends(require_admin)):
        """Restore draft teams and group winners after an accidental re-seed."""
        return await _repair_wc_team_references(db)

    @router.get("/admin/world-cup/playoff-slots")
    async def admin_wc_playoff_slots(current_user: dict = Depends(require_admin)):
        slots = await _build_playoff_slots_status(db)
        pending = [s for s in slots if not s.get("resolved")]
        return {
            "slots": slots,
            "pending_count": len(pending),
            "all_resolved": len(pending) == 0,
        }

    @router.post("/admin/world-cup/resolve-playoffs")
    async def admin_wc_resolve_all_playoffs(
        body: WorldCupPlayoffResolveBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _apply_all_playoff_resolutions(db, dry_run=bool(body.dry_run))

    @router.post("/admin/world-cup/resolve-playoff/{placeholder_code}")
    async def admin_wc_resolve_playoff_slot(
        placeholder_code: str,
        body: WorldCupPlayoffResolveBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _apply_playoff_resolution(db, placeholder_code, dry_run=bool(body.dry_run))

    @router.patch("/admin/world-cup/config")
    async def admin_wc_config(body: WorldCupConfigPatch, current_user: dict = Depends(require_admin)):
        patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
        if not patch:
            return await _load_config(db)
        if patch.get("enabled") is False:
            patch.setdefault("auto_sync_enabled", False)
        patch["updated_at"] = _now_iso()
        await db.game_config.update_one({"id": CONFIG_ID}, {"$set": patch}, upsert=True)
        return await _load_config(db)

    @router.get("/admin/world-cup/config")
    async def admin_wc_get_config(current_user: dict = Depends(require_admin)):
        return await _load_config(db)

    @router.get("/admin/world-cup/overview")
    async def admin_wc_overview(
        username: Optional[str] = Query(None),
        limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(require_admin),
    ):
        return await _build_admin_overview(db, username, limit)

    @router.get("/admin/world-cup/user/{user_id}")
    async def admin_wc_user_detail(user_id: str, current_user: dict = Depends(require_admin)):
        return await _build_admin_user_detail(db, user_id)

    @router.post("/admin/world-cup/sync-fixtures")
    async def admin_wc_sync(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            raise HTTPException(status_code=400, detail="Enable event first")
        synced = await _sync_fixtures_from_odds(db)
        draft = await _auto_run_draft_if_due(db, send_notification)
        return {**synced, "auto_draft": draft}

    @router.post("/admin/world-cup/auto-settle-run")
    async def admin_wc_auto_settle(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            raise HTTPException(status_code=400, detail="Enable event first")
        return await _auto_settle_from_scores(db, send_notification)

    @router.get("/admin/world-cup/auto-sync-health")
    async def admin_wc_health(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        unsettled = await db.world_cup_matches.count_documents({"status": {"$ne": "settled"}})
        entrants = await db.world_cup_entries.count_documents({})
        real_entrants = await db.world_cup_entries.count_documents({"ghost_entry": {"$ne": True}})
        ghost_entrants = await db.world_cup_entries.count_documents({"ghost_entry": True})
        pending = await _pending_payout_counts(db)
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        return {
            "enabled": bool(cfg.get("enabled")),
            "auto_sync_enabled": bool(cfg.get("auto_sync_enabled", True)),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
            "unsettled_matches": unsettled,
            "entrants": entrants,
            "real_entrants": real_entrants,
            "ghost_entrants": ghost_entrants,
            "draft_run": bool(cfg.get("draft_run")),
            "odds_api_configured": bool(sb._odds_api_key()),
            "auto_draft_ran_at": cfg.get("auto_draft_ran_at"),
            **pending,
            **draft_timing,
        }

    @router.get("/admin/world-cup/pending-payouts")
    async def admin_wc_pending_payouts(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(require_admin)):
        return await _list_pending_payouts(db, limit)

    @router.post("/admin/world-cup/approve-payout/{prediction_id}")
    async def admin_wc_approve_payout(prediction_id: str, current_user: dict = Depends(require_admin)):
        return await _approve_prediction_payout(db, send_notification, prediction_id, current_user.get("id") or "")

    @router.post("/admin/world-cup/approve-jackpot/{user_id}")
    async def admin_wc_approve_jackpot(user_id: str, current_user: dict = Depends(require_admin)):
        return await _approve_jackpot_payout(db, send_notification, user_id, current_user.get("id") or "")

    @router.post("/admin/world-cup/approve-all-payouts")
    async def admin_wc_approve_all_payouts(current_user: dict = Depends(require_admin)):
        return await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")

    @router.get("/admin/world-cup/groups-setup")
    async def admin_wc_groups_setup(current_user: dict = Depends(require_admin)):
        return await _build_groups_setup(db)

    @router.post("/admin/world-cup/group/{group_id}/winner")
    async def admin_wc_set_group_winner(
        group_id: str,
        body: GroupWinnerSetBody,
        current_user: dict = Depends(require_admin),
    ):
        team = await _resolve_winner_team_in_group(
            db, group_id, team_id=body.team_id, team_name=body.team_name
        )
        cfg = await _load_config(db)
        return await _set_group_winner_manual(
            db, send_notification, cfg, group_id, team["id"], force=bool(body.force)
        )

    @router.post("/admin/world-cup/group-winners/bulk")
    async def admin_wc_set_group_winners_bulk(
        body: GroupWinnersBulkBody,
        current_user: dict = Depends(require_admin),
    ):
        cfg = await _load_config(db)
        results = []
        total_preds = 0
        for raw_gid, pick in (body.winners or {}).items():
            if not pick or not str(pick).strip():
                continue
            gid = str(raw_gid).strip().upper()
            team = await _resolve_winner_pick_in_group(db, gid, str(pick))
            row = await _set_group_winner_manual(
                db, send_notification, cfg, gid, team["id"], force=bool(body.force)
            )
            total_preds += int(row.get("predictions_settled") or 0)
            results.append(row)
        payout = None
        if body.auto_approve and results:
            payout = await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")
        return {
            "groups_updated": len(results),
            "predictions_settled": total_preds,
            "results": results,
            "payout": payout,
        }

    @router.post("/admin/world-cup/settle-groups-and-pay")
    async def admin_wc_settle_groups_and_pay(
        body: SettleGroupsPayBody,
        current_user: dict = Depends(require_admin),
    ):
        cfg = await _load_config(db)
        settled = await _settle_all_groups_comprehensive(db, send_notification, cfg)
        payout = None
        if body.auto_approve:
            payout = await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")
        return {**settled, "payout": payout}

    @router.get("/admin/world-cup/group-payouts/report")
    async def admin_wc_group_payouts_report(current_user: dict = Depends(require_admin)):
        return await _build_group_winner_payout_report(db)

    @router.post("/admin/world-cup/group-payouts/pay")
    async def admin_wc_group_payouts_pay(
        body: GroupPayoutPayBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _pay_pending_group_winner_payouts(
            db,
            send_notification,
            current_user.get("id") or "",
            dry_run=bool(body.dry_run),
        )

    @router.post("/admin/world-cup/group-payouts/mark-manual-paid")
    async def admin_wc_group_payouts_mark_manual_paid(
        body: GroupPayoutManualPaidBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _mark_group_winner_payouts_manually_paid(
            db,
            current_user.get("id") or "",
            body.prediction_ids,
        )

    @router.post("/admin/world-cup/preview-user-group-picks")
    async def admin_wc_preview_user_group_picks(
        body: GroupPicksPreviewBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _preview_user_group_picks_from_text(
            db,
            username=body.username,
            picks=body.picks,
            picks_text=body.picks_text,
        )

    @router.post("/admin/world-cup/restore-user-group-picks")
    async def admin_wc_restore_user_group_picks(
        body: GroupPicksRestoreBody,
        current_user: dict = Depends(require_admin),
    ):
        return await _staff_restore_user_group_picks(
            db,
            send_notification,
            username=body.username,
            picks=body.picks,
            picks_text=body.picks_text,
            re_settle=bool(body.re_settle),
            create_missing=bool(body.create_missing),
            auto_approve=bool(body.auto_approve),
            approver_id=current_user.get("id") or "",
        )

    @router.post("/admin/world-cup/matches/bulk")
    async def admin_wc_bulk_matches(body: BulkMatchImport, current_user: dict = Depends(require_admin)):
        inserted = 0
        for raw in body.matches or []:
            home_id = raw.get("home_team_id")
            away_id = raw.get("away_team_id")
            kickoff = raw.get("kickoff") or _now_iso()
            doc = {
                "id": str(uuid.uuid4()),
                "home_team_id": home_id,
                "away_team_id": away_id,
                "kickoff": kickoff,
                "lock_at": _lock_at_from_kickoff(kickoff),
                "stage": raw.get("stage") or "group",
                "group_id": raw.get("group_id"),
                "status": "scheduled",
                "created_at": _now_iso(),
            }
            await db.world_cup_matches.insert_one(doc)
            inserted += 1
        return {"inserted": inserted}

    # --- Cron ---
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify_wc_cron(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
        if (x_cron_secret or "").strip() != cron_secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    async def _cron_guard():
        cfg = await _load_config(db)
        if not cfg.get("enabled") or not cfg.get("auto_sync_enabled", True):
            return {"message": "event_disabled", "enabled": cfg.get("enabled")}
        return None

    @router.post("/world-cup/cron/sync-fixtures")
    async def wc_cron_sync(_: None = Depends(verify_wc_cron)):
        disabled = await _cron_guard()
        if disabled:
            return disabled
        synced = await _sync_fixtures_from_odds(db)
        draft = await _auto_run_draft_if_due(db, send_notification)
        return {**synced, "auto_draft": draft}

    @router.post("/world-cup/cron/auto-settle")
    async def wc_cron_settle(_: None = Depends(verify_wc_cron)):
        disabled = await _cron_guard()
        if disabled:
            return disabled
        return await _auto_settle_from_scores(db, send_notification)

    @router.post("/world-cup/cron/auto-draft")
    async def wc_cron_auto_draft(_: None = Depends(verify_wc_cron)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            return {"skipped": True, "reason": "disabled"}
        return await _auto_run_draft_if_due(db, send_notification)


async def run_world_cup_auto_draft_ticker():
    """Background ticker: run team draft 24h before tournament start."""
    import server as srv

    interval = max(300, int(os.environ.get("WORLD_CUP_AUTO_DRAFT_INTERVAL_SEC", "900")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled"):
                result = await _auto_run_draft_if_due(srv.db, srv.send_notification)
                if result.get("ok"):
                    logger.info("World Cup auto-draft ran: %s", result)
        except Exception as ex:
            logger.warning("World Cup auto-draft ticker: %s", ex)
        await asyncio.sleep(interval)


async def run_world_cup_auto_settle_ticker():
    """Background ticker for World Cup auto-settle."""
    import server as srv

    interval = max(900, int(os.environ.get("WORLD_CUP_AUTO_SETTLE_INTERVAL_SEC", "1800")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled") and cfg.get("auto_sync_enabled", True):
                await _auto_settle_from_scores(srv.db, srv.send_notification)
        except Exception as ex:
            logger.warning("World Cup auto-settle ticker: %s", ex)
        await asyncio.sleep(interval)


async def run_world_cup_sync_ticker():
    """Background ticker for daily-ish fixture sync."""
    import server as srv

    interval = max(3600, int(os.environ.get("WORLD_CUP_SYNC_INTERVAL_SEC", "86400")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled") and cfg.get("auto_sync_enabled", True):
                await _sync_fixtures_from_odds(srv.db)
        except Exception as ex:
            logger.warning("World Cup sync ticker: %s", ex)
        await asyncio.sleep(interval)
