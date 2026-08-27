"""In-memory pulse so kill-page hunters see a target city change as soon as they travel."""
from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

_rev: Dict[str, int] = {}
_patches: Dict[str, List[dict]] = {}
_seq = 0


def hunter_pulse_snapshot(attacker_id: str, since: int = 0) -> dict:
    aid = str(attacker_id or "").strip()
    rev = int(_rev.get(aid, 0) or 0)
    if rev <= int(since or 0):
        return {"rev": rev, "changed": False, "rows": []}
    return {"rev": rev, "changed": True, "rows": list(_patches.get(aid) or [])}


def _store_hunter_patches(by_attacker: Dict[str, List[dict]]) -> None:
    global _seq
    if not by_attacker:
        return
    _seq += 1
    rev = _seq
    for aid, rows in by_attacker.items():
        if not aid or not rows:
            continue
        _rev[str(aid)] = rev
        _patches[str(aid)] = rows


async def notify_hunters_target_moved(
    db,
    target_id: str,
    *,
    location_state: Optional[str],
    traveling_to: Optional[str] = None,
) -> int:
    """Bump every hunter who has a FOUND row on this target. Returns hunter count."""
    tid = str(target_id or "").strip()
    loc = (location_state or "").strip() or None
    hop = (traveling_to or "").strip() or None
    if not tid or not loc:
        return 0
    by_attacker: Dict[str, List[dict]] = {}
    try:
        cursor = db.attacks.find(
            {"target_id": tid, "status": "found"},
            {"_id": 0, "id": 1, "attacker_id": 1},
        )
        async for a in cursor:
            aid = str(a.get("attacker_id") or "").strip()
            attack_id = a.get("id")
            if not aid or not attack_id:
                continue
            by_attacker.setdefault(aid, []).append(
                {
                    "attack_id": attack_id,
                    "location_state": loc,
                    "traveling_to": hop,
                }
            )
    except Exception:
        return 0
    if not by_attacker:
        return 0
    _store_hunter_patches(by_attacker)
    try:
        from routers.kill.attack import _attack_list_cache_invalidate

        for aid in by_attacker:
            _attack_list_cache_invalidate(aid)
    except Exception:
        pass
    return len(by_attacker)


def schedule_notify_hunters_target_moved(
    db,
    target_id: str,
    *,
    location_state: Optional[str],
    traveling_to: Optional[str] = None,
) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    try:
        loop.create_task(
            notify_hunters_target_moved(
                db,
                target_id,
                location_state=location_state,
                traveling_to=traveling_to,
            )
        )
    except Exception:
        pass
