"""Pure helpers for merging illegal-business mission progress on kill takeover."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def merge_ibm_completion_rows(killer_rows, victim_rows) -> List[dict]:
    """Union mission completions by mission_id (killer rows win on conflict)."""
    by_id: Dict[str, dict] = {}
    for row in killer_rows or []:
        mid = (row or {}).get("mission_id")
        if mid:
            by_id[str(mid)] = dict(row)
    for row in victim_rows or []:
        mid = (row or {}).get("mission_id")
        if not mid:
            continue
        mid = str(mid)
        if mid in by_id:
            continue
        copied = dict(row)
        copied["via_takeover"] = True
        by_id[mid] = copied
    return list(by_id.values())


def merge_ibm_baseline_maps(killer_map, victim_map) -> dict:
    """Keep killer baselines; fill missing mission keys from victim."""
    out = dict(killer_map or {})
    for mid, block in (victim_map or {}).items():
        if mid not in out and isinstance(block, dict):
            out[mid] = dict(block)
    return out
