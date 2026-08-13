"""Staff modkill (wipe): reset progression, block £10 Dead > Alive, post Topic of Shame."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MODKILLED_BADGE = "Modkilled"
_REASON_MAX = 400
_TAG_RE = re.compile(r"[\[\]<>]")
_WS_RE = re.compile(r"\s+")

_WEEKLY_EVENT_COLLECTIONS = (
    "crime_events",
    "gta_events",
    "bust_events",
    "melt_events",
    "badge_events",
    "respect_events",
)


def sanitize_modkill_wipe_reason(raw: Any) -> str:
    s = str(raw or "")
    s = _TAG_RE.sub("", s)
    s = s.replace("\r", " ").replace("\n", " ")
    s = _WS_RE.sub(" ", s).strip()
    if len(s) > _REASON_MAX:
        s = s[:_REASON_MAX].rstrip()
    return s


def account_blocks_dead_alive_revive(user: Optional[dict]) -> bool:
    """True if this character cannot be brought back via £10 Dead > Alive."""
    return bool(user and user.get("modkill_wipe"))


_CASINO_SHAME_LABELS = {
    "dice": "Dice",
    "roulette": "Roulette",
    "blackjack": "Blackjack",
    "horseracing": "Horse Racing",
    "videopoker": "Video Poker",
    "slots": "Slots",
}


def _bbcode_safe(raw: Any) -> str:
    s = str(raw or "")
    s = _TAG_RE.sub("", s)
    s = s.replace("\r", " ").replace("\n", " ")
    s = _WS_RE.sub(" ", s).strip()
    return s


def _place_label(doc: Optional[dict]) -> str:
    if not doc:
        return ""
    city = _bbcode_safe(doc.get("city"))
    state = _bbcode_safe(doc.get("state"))
    if city and state and city.lower() != state.lower():
        return f"{city}, {state}"
    return city or state or ""


async def snapshot_wipe_holdings(db, user_id: str) -> Dict[str, Any]:
    """Player-safe holdings to list on Topic of Shame (locations, loot, family). Capture before seize."""
    uid = (user_id or "").strip()
    out: Dict[str, Any] = {
        "casinos": [],
        "airports": [],
        "armouries": [],
        "family_name": None,
        "family_role": None,
        "was_boss": False,
        "family_id": None,
        "vault_relics": [],
        "exclusive_weed": [],
    }
    if not uid:
        return out

    from utils.admin_kill_asset_transfer import _casino_collections

    for game_type, coll in _casino_collections(db):
        if coll is None:
            continue
        d = await coll.find_one({"owner_id": uid}, {"_id": 0, "city": 1, "state": 1})
        if d:
            label = _CASINO_SHAME_LABELS.get(game_type, game_type)
            place = _place_label(d)
            out["casinos"].append(f"{label} — {place}" if place else label)

    if getattr(db, "airport_ownership", None) is not None:
        async for d in db.airport_ownership.find({"owner_id": uid}, {"_id": 0, "state": 1, "slot": 1, "city": 1}):
            place = _place_label(d) or _bbcode_safe(d.get("state"))
            slot = d.get("slot")
            bit = f"Airport — {place}" if place else "Airport"
            if slot is not None and str(slot).strip() != "":
                bit += f" (slot {slot})"
            out["airports"].append(bit)

    if getattr(db, "bullet_factory", None) is not None:
        async for d in db.bullet_factory.find({"owner_id": uid}, {"_id": 0, "state": 1, "city": 1}):
            place = _place_label(d)
            out["armouries"].append(f"Armoury — {place}" if place else "Armoury")

    user = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "family_id": 1, "family_name": 1, "family_role": 1},
    )
    fam_id = (user or {}).get("family_id")
    role = _bbcode_safe((user or {}).get("family_role"))
    fam_name = _bbcode_safe((user or {}).get("family_name"))
    if fam_id:
        fam = await db.families.find_one({"id": fam_id}, {"_id": 0, "name": 1, "boss_id": 1})
        if fam:
            fam_name = _bbcode_safe(fam.get("name")) or fam_name
            out["was_boss"] = str(fam.get("boss_id") or "") == uid
    out["family_name"] = fam_name or None
    out["family_role"] = role or None
    out["family_id"] = fam_id or None

    try:
        from utils.loot_reclaimable_passives import item_display_name, user_owned_item_ids

        ids = sorted(await user_owned_item_ids(db, uid))
        out["vault_relics"] = [_bbcode_safe(item_display_name(i)) for i in ids]
    except Exception:
        logger.exception("modkill wipe: vault relic snapshot failed user=%s", uid)

    try:
        from utils.weed_empire_exclusive_strains import (
            exclusive_strain_display_name,
            get_owned_exclusive_strain_ids,
        )

        sids = sorted(await get_owned_exclusive_strain_ids(db, uid))
        out["exclusive_weed"] = [_bbcode_safe(exclusive_strain_display_name(s)) for s in sids]
    except Exception:
        logger.exception("modkill wipe: exclusive weed snapshot failed user=%s", uid)

    return out


def _shame_taken_lines(holdings: Optional[dict], extra: Optional[dict] = None) -> list:
    h = holdings or {}
    extra = extra or {}
    lines = []
    world = list(h.get("casinos") or []) + list(h.get("airports") or []) + list(h.get("armouries") or [])
    if world:
        lines.append("Taken: " + "; ".join(world) + ".")
    else:
        lines.append("Taken: no casino, airport, or armoury on this account.")

    relics = list(h.get("vault_relics") or [])
    if relics:
        lines.append("Loot returned to the game: " + ", ".join(relics) + ".")

    weed = list(h.get("exclusive_weed") or [])
    if weed:
        lines.append("Exclusive weed strains returned: " + ", ".join(weed) + ".")

    fam = h.get("family_name")
    if fam:
        if h.get("was_boss"):
            new_boss = _bbcode_safe(extra.get("new_boss_username") or "")
            if new_boss:
                lines.append(f"Removed as boss of {fam}. {new_boss} is now boss.")
            else:
                lines.append(f"Removed as boss of {fam}. Next in line promoted.")
        else:
            role = h.get("family_role")
            bit = f" ({role})" if role else ""
            lines.append(f"Removed from family: {fam}{bit}.")
    return lines


def _shame_bbcode(
    *,
    username: str,
    reason: str,
    day: str,
    holdings: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> str:
    what = reason or "Rule breaking."
    taken = _shame_taken_lines(holdings, extra)
    taken_bb = "".join(f"[*][color=#888888]{line}[/color]\n" for line in taken)
    return (
        f"[size=1.5][b][color=#E74C3C]{day}[/color][/b] — [b]{_bbcode_safe(username)}[/b][/size]\n"
        "[quote]\n"
        "[list]\n"
        "[*][color=#888888][b]Action:[/b] Modkill (wipe) for rule breaking.[/color]\n"
        f"[*][color=#888888][b]What happened:[/b] {what}[/color]\n"
        f"{taken_bb}"
        "[*][color=#888888][b]Effect:[/b] Rank reset to Rat (prestige 0). Honours, leaderboards, cash, points, "
        "and Game Pass stripped. Modkilled badge added. £10 Dead > Alive revive blocked.[/color]\n"
        "[/list]\n"
        "[/quote]\n"
    )


async def append_topic_of_shame_entry(
    db,
    *,
    username: str,
    reason: str,
    holdings: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> bool:
    """Prepend a player-safe wipe entry on the locked Topic of Shame (forum + docs if writable)."""
    from utils.ensure_topic_of_shame import prepend_topic_of_shame_bbcode

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entry = _shame_bbcode(username=username, reason=reason, day=day, holdings=holdings, extra=extra)
    ok = await prepend_topic_of_shame_bbcode(db, entry)
    if ok:
        logger.info("modkill wipe: Topic of Shame updated for %s", username)
    else:
        logger.warning("modkill wipe: Topic of Shame missing after ensure")
    return ok


async def apply_modkill_wipe_after_kill(
    db,
    *,
    user_id: str,
    username: str,
    reason: str,
    staff_username: str,
    admin_user: Optional[dict] = None,
) -> Dict[str, Any]:
    """
    Strip honours/progress/Game Pass, reset to Rat / prestige 0, add Modkilled badge,
    block £10 revive, and post Topic of Shame.

    Always: family boss succession, seize casinos/airport/armoury to staff (leftover
    unowned), vault relics / unique loot back into the game.
    """
    from utils.ban_user_wipe import wipe_user_for_account_ban

    uid = (user_id or "").strip()
    uname = (username or "").strip() or "?"
    reason_clean = sanitize_modkill_wipe_reason(reason) or "Rule breaking."
    now_iso = datetime.now(timezone.utc).isoformat()
    extra: Dict[str, Any] = {}
    holdings = await snapshot_wipe_holdings(db, uid)
    fam_id_snap = holdings.get("family_id")

    await db.users.update_one({"id": uid}, {"$set": {"is_dead": True}})

    try:
        from routers.game.families import maybe_promote_after_boss_death, _invalidate_list_cache

        await maybe_promote_after_boss_death(uid)
        _invalidate_list_cache()
        extra["family_promoted"] = True
        if fam_id_snap:
            fam_doc = await db.families.find_one({"id": fam_id_snap}, {"_id": 0, "boss_id": 1})
            new_boss_id = (fam_doc or {}).get("boss_id")
            if new_boss_id and str(new_boss_id) != uid:
                boss_u = await db.users.find_one({"id": new_boss_id}, {"_id": 0, "username": 1})
                extra["new_boss_username"] = (boss_u or {}).get("username")
    except Exception:
        logger.exception("modkill wipe: family boss promote failed user=%s", uid)
        extra["family_promoted"] = False

    if admin_user:
        try:
            from utils.admin_kill_asset_transfer import transfer_staff_kill_seizures

            extra["seize"] = await transfer_staff_kill_seizures(db, uid, admin_user)
        except Exception:
            logger.exception("modkill wipe: seize casinos/airport/armoury failed user=%s", uid)

    try:
        from utils.loot_reclaimable_passives import reclaim_on_kill

        extra["vault_relics"] = await reclaim_on_kill(
            db,
            victim_id=uid,
            victim_username=uname,
            killer_id=(admin_user or {}).get("id") if admin_user else None,
        )
    except Exception:
        logger.exception("modkill wipe: vault relic reclaim failed user=%s", uid)

    try:
        from utils.weed_empire_exclusive_strains import release_exclusive_weed_strains_to_pool

        extra["exclusive_weed"] = await release_exclusive_weed_strains_to_pool(db, uid)
    except Exception:
        logger.exception("modkill wipe: exclusive weed release failed user=%s", uid)

    try:
        from routers.money.quicktrade import cancel_offers_on_death

        await cancel_offers_on_death(uid)
    except Exception:
        logger.exception("modkill wipe: cancel quicktrade failed user=%s", uid)

    wipe_summary = await wipe_user_for_account_ban(db, uid, preserve_dead=True)
    try:
        from utils.admin_kill_asset_transfer import _invalidate_casino_caches_for

        await _invalidate_casino_caches_for([uid, str((admin_user or {}).get("id") or "")])
    except Exception:
        logger.exception("modkill wipe: casino cache invalidate failed")

    try:
        from routers.money.loot_box import resync_loot_exclusive_claimed_counts_from_live

        extra["loot_claimed"] = await resync_loot_exclusive_claimed_counts_from_live()
    except Exception:
        logger.exception("modkill wipe: loot claimed resync failed")

    try:
        from routers.cars.gta import _sync_gta_exclusive_pool_release_state

        extra["gta_exclusive_pool_released"] = await _sync_gta_exclusive_pool_release_state()
    except Exception:
        logger.exception("modkill wipe: GTA exclusive pool sync failed")

    extra_deleted: Dict[str, int] = {}
    for key in _WEEKLY_EVENT_COLLECTIONS:
        coll = getattr(db, key, None)
        if coll is None:
            continue
        r = await coll.delete_many({"user_id": uid})
        extra_deleted[key] = int(r.deleted_count or 0)

    from utils.founding_member import FOUNDING_MEMBER_BADGE
    from utils.player_death import player_death_set_fields
    from utils.profile_cosmetics import CUSTOM_PROFILE_BADGE

    badge_doc = await db.users.find_one({"id": uid}, {"_id": 0, "badges": 1})
    strip_badges = {FOUNDING_MEMBER_BADGE, CUSTOM_PROFILE_BADGE}
    badges = [b for b in ((badge_doc or {}).get("badges") or []) if b not in strip_badges]
    if MODKILLED_BADGE not in badges:
        badges.append(MODKILLED_BADGE)

    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "death_by_staff": True,
                "modkill_wipe": True,
                "modkill_wipe_at": now_iso,
                "modkill_wipe_reason": reason_clean,
                "modkill_wipe_by": staff_username,
                "money": 0,
                "points": 0,
                "respect_points": 0,
                "rank": 1,
                "rank_points": 0,
                "prestige_level": 0,
                "prestige_rank_multiplier": 1.0,
                "health": 0,
                "points_at_death": 0,
                "money_at_death": 0,
                "tokens_at_death": {},
                "retrieval_used": True,
                "swiss_retrieval_used": True,
                "rank_xp_pass_dead_alive_carry_used": True,
                "game_pass_weed_strain_ids": [],
                "loot_reclaimable_passive_ids": [],
                "killed_by_username": "Staff (modkill wipe)",
                "total_kills": 0,
                "robot_bodyguard_kills": 0,
                "badges": badges,
                **player_death_set_fields(),
            },
            "$unset": {
                "death_revive_snapshot": "",
                "rank_xp_pass_bonus_until": "",
                "rank_xp_pass_token_expires_at": "",
                "rank_xp_pass_tier_snapshot": "",
                "rank_xp_pass_pending_tier_snapshot": "",
                "game_pass_season_id": "",
            },
        },
    )

    shame_ok = False
    try:
        shame_ok = await append_topic_of_shame_entry(
            db,
            username=uname,
            reason=reason_clean,
            holdings=holdings,
            extra=extra,
        )
    except Exception:
        logger.exception("modkill wipe: Topic of Shame append failed user=%s", uname)

    try:
        from routers.game.leaderboard import invalidate_leaderboard_cache

        invalidate_leaderboard_cache()
    except Exception:
        logger.exception("modkill wipe: leaderboard cache invalidate failed")

    return {
        "wipe": wipe_summary,
        "weekly_events_deleted": extra_deleted,
        "topic_of_shame": shame_ok,
        "reason": reason_clean,
        **extra,
    }
