"""Rules for showing attack_attempt rows in global stats / kill feeds."""
from typing import Optional


def is_hitlist_npc_kill_excluded_from_stats(attempt: dict, victim_user: Optional[dict]) -> bool:
    """True = omit from Last N kills-style lists (hitlist NPCs only; robot bodyguards stay visible)."""
    if attempt.get("is_bodyguard_kill"):
        return False
    if attempt.get("is_npc_kill"):
        return True
    if attempt.get("target_is_npc"):
        return True
    if victim_user and victim_user.get("is_npc"):
        return True
    un = (attempt.get("target_username") or "").strip()
    if "(npc)" in un.lower():
        return True
    return False
