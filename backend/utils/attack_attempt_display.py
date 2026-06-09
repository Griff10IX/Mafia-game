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


def attempt_make_public(attempt: dict) -> bool:
    """Attacker opted in to publicize this kill (flash news ticker)."""
    v = attempt.get("make_public")
    if v is True:
        return True
    if v is False or v is None:
        return False
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes")
    return bool(v)


def stats_kill_shows_killer_username(
    attempt: dict,
    *,
    viewer_id: str,
    victim_user: Optional[dict],
    staff_can_see: bool,
) -> bool:
    """Public stats feed: hide killer unless staff, attacker opted in, victim revealed, or viewer is killer."""
    if staff_can_see:
        return True
    if attempt_make_public(attempt):
        return True
    attacker_id = str(attempt.get("attacker_id") or "")
    if viewer_id and attacker_id and viewer_id == attacker_id:
        return True
    if victim_user and victim_user.get("killer_revealed"):
        return True
    return False
