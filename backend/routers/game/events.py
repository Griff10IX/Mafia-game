# Events: active event(s), flash news (ticker)
from datetime import datetime, timezone, timedelta

from fastapi import Depends

from server import db, get_current_user, get_effective_event, get_effective_event_full, get_events_enabled, GAME_EVENTS_BY_ID
from routers.money.booze_run import get_booze_rotation_interval_seconds, get_booze_rotation_index

# Rotating tips for flash news ticker (multiple shown per load so the bar has variety)
FLASH_NEWS_TIPS = [
    "Organised Crime: run heists with you + 3 NPCs for big payouts.",
    "Booze Run: buy low, travel, sell high. Prices rotate every few hours.",
    "Auto Rank: automate crimes, GTA, busts and booze from Account → Auto Rank.",
    "Stock market: buy and sell shares. Check Money → Stock Market.",
    "Jail: bust out or wait. Bodyguards can reduce your sentence.",
    "GTA: steal cars for cash and rank. Unlock better options as you rank up.",
    "Family rackets: run rackets for your family. Payouts vary by daily event.",
    "Missions: complete objectives for rewards. Account → Missions.",
    "Swiss Bank: protects your cash when you die. Use it.",
    "Hitlist: place bounties on players. NPC targets available for practice.",
    "Daily rewards: play Rock Paper Scissors every 6h for free cash and cars.",
    "Loot boxes: collect 100 pieces from crimes and GTA to open a box.",
]


async def get_active_event(current_user: dict = Depends(get_current_user)):
    """Current game-wide event(s) when enabled; includes rotation info."""
    enabled = await get_events_enabled()
    if not enabled:
        return {"event": None, "events_enabled": False, "active_event_ids": [], "active_event_names": [], "expires_at": None, "duration_hours": 0}
    full = await get_effective_event_full()
    names = [GAME_EVENTS_BY_ID.get(eid, {}).get("name", eid) for eid in (full.get("event_ids") or [])]
    return {
        "event": full["event"],
        "events_enabled": True,
        "active_event_ids": full.get("event_ids") or [],
        "active_event_names": names,
        "expires_at": full.get("expires_at"),
        "duration_hours": full.get("duration_hours", 0),
    }


async def get_flash_news(current_user: dict = Depends(get_current_user)):
    """Recent flash news: wars, booze price changes, etc. For the top-bar ticker."""
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    items = []
    try:
        full = await get_effective_event_full()
        ev = full.get("event") or {}
        if ev.get("id") != "none" and full.get("event_ids"):
            names = [GAME_EVENTS_BY_ID.get(eid, {}).get("name", eid) for eid in full["event_ids"]]
            expires_raw = full.get("expires_at") or ""
            remaining_str = ""
            if expires_raw:
                try:
                    exp_dt = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
                    if exp_dt.tzinfo is None:
                        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                    secs = max(0, int((exp_dt - now).total_seconds()))
                    h, m = secs // 3600, (secs % 3600) // 60
                    remaining_str = f" — changes in {h}h {m}m" if h else f" — changes in {m}m"
                except Exception:
                    pass
            msg = "Active: " + ", ".join(names) + remaining_str
            ids_key = "_".join(full["event_ids"])
            items.append({
                "id": f"event_{ids_key}",
                "type": "game_event",
                "message": msg,
                "at": now.isoformat(),
            })
    except Exception:
        pass
    try:
        interval = get_booze_rotation_interval_seconds()
        rotation_index = get_booze_rotation_index()
        rotation_start_ts = rotation_index * interval
        rotation_start_iso = datetime.fromtimestamp(rotation_start_ts, tz=timezone.utc).isoformat()
        if now_ts - rotation_start_ts < interval:
            items.append({
                "id": f"booze_rotation_{rotation_index}",
                "type": "booze_prices",
                "message": "Booze prices just changed — see Booze Run for rates.",
                "at": rotation_start_iso,
            })
    except Exception:
        pass
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    families = await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(50)
    family_map = {f["id"]: f for f in families}
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        a_name = fa.get("name") or "?"
        b_name = fb.get("name") or "?"
        status = w.get("status")
        ended_at = w.get("ended_at")
        created_at = w.get("created_at") or ""
        if status in ("active", "truce_offered"):
            items.append({"id": w.get("id"), "type": "war_started", "message": f"War: {a_name} vs {b_name}", "at": created_at})
        elif ended_at:
            winner_id = w.get("winner_family_id")
            loser_id = w.get("loser_family_id")
            if status == "truce":
                items.append({"id": w.get("id") + "_truce", "type": "war_ended", "message": f"War ended: {a_name} vs {b_name} — truce", "at": ended_at})
            elif winner_id and loser_id:
                winner = family_map.get(winner_id, {})
                loser = family_map.get(loser_id, {})
                wn = winner.get("name") or "?"
                ln = loser.get("name") or "?"
                items.append({"id": w.get("id") + "_end", "type": "war_ended", "message": f"War ended: {wn} defeated {ln}", "at": ended_at})
            else:
                items.append({"id": w.get("id") + "_end", "type": "war_ended", "message": f"War ended: {a_name} vs {b_name}", "at": ended_at})

    # Hitlist additions (recent, non-hidden, user/bodyguard only — no NPCs; cap 3)
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    try:
        hitlist_docs = await db.hitlist.find({"hidden": {"$ne": True}, "target_type": {"$ne": "npc"}}).sort("created_at", -1).limit(10).to_list(10)
        for i, doc in enumerate(hitlist_docs):
            if i >= 3:
                break
            created_at = doc.get("created_at") or ""
            if created_at and str(created_at) < cutoff_24h:
                continue
            target = doc.get("target_username") or "Someone"
            reward_type = doc.get("reward_type") or "cash"
            amount = doc.get("reward_amount") or 0
            if reward_type == "points":
                msg = f"{target} was added to the hitlist for {amount} pts"
            else:
                msg = f"{target} was added to the hitlist for ${amount:,}"
            items.append({
                "id": f"hitlist_{doc.get('id', i)}",
                "type": "hitlist_add",
                "message": msg,
                "at": created_at if isinstance(created_at, str) else (created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)),
            })
    except Exception:
        pass

    # Users in jail (one item; only if >= 2 to avoid permanent single-user line)
    try:
        jail_count = await db.users.count_documents({"in_jail": True})
        if jail_count >= 2:
            users_word = "users" if jail_count != 1 else "user"
            items.append({
                "id": f"jail_count_{now.date().isoformat()}",
                "type": "jail_count",
                "message": f"{jail_count} {users_word} currently in jail.",
                "at": now.isoformat(),
            })
    except Exception:
        pass

    # Recent public player kills (cap 5) — only kills the attacker marked as public
    try:
        kill_docs = await db.attack_attempts.find({
            "outcome": "killed",
            "make_public": True,
            "$or": [
                {"target_is_npc": {"$ne": True}},
                {"$and": [{"is_bodyguard_kill": True}, {"is_npc_kill": {"$ne": True}}]},
            ],
        }).sort("created_at", -1).limit(10).to_list(10)
        for i, doc in enumerate(kill_docs):
            if i >= 5:
                break
            target = doc.get("target_username") or "Someone"
            attacker = doc.get("attacker_username") or "?"
            created_at = doc.get("created_at") or ""
            at_str = created_at if isinstance(created_at, str) else (created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at))
            items.append({
                "id": f"kill_{doc.get('id', i)}",
                "type": "kill",
                "message": f"{target} was killed by {attacker}",
                "at": at_str,
            })
    except Exception:
        pass

    # Badge earned (from badge_events; cap 5)
    try:
        badge_docs = await db.badge_events.find({}).sort("created_at", -1).limit(10).to_list(10)
        for i, doc in enumerate(badge_docs):
            if i >= 5:
                break
            username = doc.get("username") or "Someone"
            category_name = doc.get("category_name") or doc.get("category_id") or "Badge"
            tier_label = doc.get("tier_label") or str(doc.get("tier_target", ""))
            created_at = doc.get("created_at") or ""
            at_str = created_at if isinstance(created_at, str) else (created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at))
            items.append({
                "id": f"badge_{str(doc.get('_id', i))}",
                "type": "badge_earned",
                "message": f"{username} earned the {category_name} badge ({tier_label}).",
                "at": at_str,
            })
    except Exception:
        pass

    # Lottery winners (cap 3)
    try:
        lottery_docs = await db.lottery_events.find({"type": "lottery_winner"}).sort("drawn_at", -1).limit(3).to_list(3)
        for doc in lottery_docs:
            winner = doc.get("winner_username") or "Someone"
            payout = doc.get("payout") or 0
            drawn_at = doc.get("drawn_at") or ""
            at_str = drawn_at if isinstance(drawn_at, str) else (drawn_at.isoformat() if hasattr(drawn_at, "isoformat") else str(drawn_at))
            wn = doc.get("winning_numbers")
            if isinstance(wn, list) and wn:
                nums = ", ".join(str(x) for x in wn)
                lot_msg = f"{winner} won the City Lottery — numbers {nums} — ${payout:,}!"
            else:
                lot_msg = f"{winner} won the City Lottery — ${payout:,} payout!"
            items.append({
                "id": f"lottery_{str(doc.get('_id', ''))}",
                "type": "lottery_winner",
                "message": lot_msg,
                "at": at_str,
            })
    except Exception:
        pass

    # Lottery rollover (no jackpot winner — pot carries forward)
    try:
        ro_docs = await db.lottery_events.find({"type": "lottery_rollover"}).sort("drawn_at", -1).limit(2).to_list(2)
        for doc in ro_docs:
            amt = int(doc.get("rollover_amount") or 0)
            drawn_at = doc.get("drawn_at") or ""
            at_str = drawn_at if isinstance(drawn_at, str) else (drawn_at.isoformat() if hasattr(drawn_at, "isoformat") else str(drawn_at))
            wn = doc.get("winning_numbers")
            if isinstance(wn, list) and wn:
                nums = ", ".join(str(x) for x in wn)
                ro_msg = f"No jackpot winner — numbers were {nums}. ${amt:,} rolls to the next draw."
            else:
                ro_msg = f"No jackpot winner — ${amt:,} rolls to the next draw."
            items.append({
                "id": f"lottery_ro_{str(doc.get('_id', ''))}",
                "type": "lottery_rollover",
                "message": ro_msg,
                "at": at_str,
            })
    except Exception:
        pass

    # Add multiple rotating tips so the ticker has more variety (not just 3 items)
    day_index = now.date().toordinal() % len(FLASH_NEWS_TIPS)
    for offset in range(min(5, len(FLASH_NEWS_TIPS))):
        idx = (day_index + offset) % len(FLASH_NEWS_TIPS)
        tip_message = FLASH_NEWS_TIPS[idx]
        items.append({
            "id": f"tip_{idx}_{now.date().isoformat()}_{offset}",
            "type": "tip",
            "message": tip_message,
            "at": now.date().isoformat() + f"T{12 + offset:02d}:00:00+00:00",
        })
    items.sort(key=lambda x: x["at"], reverse=True)
    return {"items": items[:20]}


def register(router):
    router.add_api_route("/events/active", get_active_event, methods=["GET"])
    router.add_api_route("/news/flash", get_flash_news, methods=["GET"])
