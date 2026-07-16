"""Log and reconstruct timelines for exclusive / loot-exclusive cars."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

EXCLUSIVE_RARITIES = frozenset({"exclusive", "loot_exclusive", "vip_exclusive"})

EVENT_LABELS = {
    "market_listed": "Listed for sale",
    "market_delisted": "Delisted from marketplace",
    "market_sale": "Marketplace sale",
    "pvp_kill_transfer": "PvP kill transfer",
    "pvp_kill_lost": "Lost on PvP kill",
    "war_family_wipe": "Family war wipe (exclusive → winner boss)",
    "gta_won": "GTA steal",
    "loot_box": "Loot box reward",
    "admin_remove": "Admin remove",
    "admin_grant": "Admin grant",
    "store_purchase": "Store purchase",
    "game_pass_tier_100": "Game Pass tier 100 reward",
    "admin_transfer": "Admin transfer",
    "scraped": "Scrapped",
    "melted": "Melted",
}


def _parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        if isinstance(s, datetime):
            dt = s
        else:
            dt = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _sort_key(s: Any) -> str:
    dt = _parse_iso(s)
    return dt.isoformat() if dt else str(s or "")


def exclusive_catalog_ids(cars: list) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for c in cars or []:
        if c.get("id") and c.get("rarity") in EXCLUSIVE_RARITIES:
            out[c["id"]] = c
    return out


async def log_exclusive_car_event(
    db,
    *,
    event_type: str,
    car_id: str,
    user_car_id: Optional[str] = None,
    previous_user_car_id: Optional[str] = None,
    from_user_id: Optional[str] = None,
    from_username: Optional[str] = None,
    to_user_id: Optional[str] = None,
    to_username: Optional[str] = None,
    price: Optional[int] = None,
    car_name: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    try:
        await db.exclusive_car_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "at": datetime.now(timezone.utc).isoformat(),
                "event_type": event_type,
                "car_id": car_id,
                "user_car_id": user_car_id,
                "previous_user_car_id": previous_user_car_id,
                "from_user_id": from_user_id,
                "from_username": from_username,
                "to_user_id": to_user_id,
                "to_username": to_username,
                "price": price,
                "car_name": car_name,
                "extra": extra or {},
            }
        )
    except Exception as e:
        logger.warning("exclusive_car_events insert failed (%s): %s", event_type, e)


def _timeline_row(
    *,
    at: Any,
    event_type: str,
    source: str,
    summary: str,
    details: Optional[dict] = None,
    user_car_id: Optional[str] = None,
    car_id: Optional[str] = None,
) -> dict:
    return {
        "at": _parse_iso(at).isoformat() if _parse_iso(at) else (str(at) if at else None),
        "event_type": event_type,
        "event_label": EVENT_LABELS.get(event_type, event_type.replace("_", " ").title()),
        "source": source,
        "summary": summary,
        "user_car_id": user_car_id,
        "car_id": car_id,
        "details": details or {},
    }


def _dedupe_timeline(rows: List[dict]) -> List[dict]:
    seen: Set[str] = set()
    out: List[dict] = []
    for r in sorted(rows, key=lambda x: _sort_key(x.get("at")), reverse=True):
        key = "|".join(
            [
                str(r.get("at") or ""),
                str(r.get("event_type") or ""),
                str(r.get("source") or ""),
                str(r.get("summary") or "")[:120],
                str((r.get("details") or {}).get("user_car_id") or r.get("user_car_id") or ""),
            ]
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


async def _username_map(db, user_ids: Set[Any]) -> Dict[Any, str]:
    ids = [u for u in user_ids if u]
    if not ids:
        return {}
    users = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(ids) + 10)
    return {u.get("id"): u.get("username") or "?" for u in users}


async def _war_lock_for_user(db, user_id: str) -> Optional[dict]:
    from routers.game.families import resolve_family_id

    family_id = await resolve_family_id(user_id)
    if not family_id:
        return None
    from server import _get_active_war_for_family

    war = await _get_active_war_for_family(family_id)
    if not war:
        return None
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    opp_id = war["family_b_id"] if war.get("family_a_id") == family_id else war.get("family_a_id")
    opp = await db.families.find_one({"id": opp_id}, {"_id": 0, "name": 1, "tag": 1}) if opp_id else None
    fam_name = (fam or {}).get("name") or "?"
    opp_name = (opp or {}).get("name") or "?"
    return {
        "war_locked": True,
        "family_id": family_id,
        "family_name": fam_name,
        "family_tag": (fam or {}).get("tag"),
        "opponent_family_name": opp_name,
        "war_id": war.get("id"),
        "war_status": war.get("status"),
        "reason": f"Family {fam_name} is at war with {opp_name} — exclusive cars cannot be listed/scrapped/melted.",
    }


async def build_exclusive_car_intel(
    db,
    *,
    cars_catalog: list,
    user_car_id: Optional[str] = None,
    car_id: Optional[str] = None,
    username: Optional[str] = None,
    limit: int = 200,
) -> dict:
    """Best-effort timeline from exclusive_car_events + legacy logs."""
    catalog = exclusive_catalog_ids(cars_catalog)
    if not catalog:
        return {"instances": [], "timeline": [], "notes": ["No exclusive cars in catalog."]}

    scope_user_id: Optional[str] = None
    if username and str(username).strip():
        from server import _username_pattern

        u = await db.users.find_one({"username": _username_pattern(username.strip())}, {"_id": 0, "id": 1, "username": 1})
        if not u:
            raise ValueError("User not found")
        scope_user_id = u["id"]

    exclusive_ids = list(catalog.keys())
    car_filter = car_id.strip() if car_id and car_id.strip() and car_id.strip() != "all" else None
    if car_filter and car_filter not in catalog:
        raise ValueError(f"Unknown exclusive car_id '{car_filter}'")

    match_car_ids = [car_filter] if car_filter else exclusive_ids

    # Current garage rows
    uc_query: Dict[str, Any] = {"car_id": {"$in": match_car_ids}}
    if user_car_id and str(user_car_id).strip():
        uid = str(user_car_id).strip()
        uc_query = {
            "$and": [
                {"car_id": {"$in": match_car_ids}},
                {"$or": [{"id": uid}, {"_id": uid}]},
            ]
        }
    elif scope_user_id:
        uc_query["user_id"] = scope_user_id

    instances_raw = await db.user_cars.find(
        uc_query,
        {
            "_id": 0,
            "id": 1,
            "user_id": 1,
            "car_id": 1,
            "car_name": 1,
            "custom_name": 1,
            "acquired_at": 1,
            "listed_for_sale": 1,
            "sale_price": 1,
            "listed_at": 1,
        },
    ).to_list(500)

    user_ids: Set[Any] = set()
    user_car_ids: Set[str] = set()
    for uc in instances_raw:
        if uc.get("user_id"):
            user_ids.add(uc["user_id"])
        if uc.get("id"):
            user_car_ids.add(str(uc["id"]))

    timeline: List[dict] = []

    # Dedicated event log (new)
    ev_q: Dict[str, Any] = {"car_id": {"$in": match_car_ids}}
    ev_ors: List[dict] = []
    if user_car_id and str(user_car_id).strip():
        uid = str(user_car_id).strip()
        ev_ors.append({"user_car_id": uid})
        ev_ors.append({"previous_user_car_id": uid})
    if scope_user_id:
        ev_ors.append({"from_user_id": scope_user_id})
        ev_ors.append({"to_user_id": scope_user_id})
    if user_car_ids:
        ev_ors.extend([{"user_car_id": {"$in": list(user_car_ids)}}, {"previous_user_car_id": {"$in": list(user_car_ids)}}])
    if ev_ors:
        ev_q["$or"] = ev_ors

    ev_rows = await db.exclusive_car_events.find(ev_q, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    for e in ev_rows:
        et = e.get("event_type") or "unknown"
        parts = []
        if e.get("from_username"):
            parts.append(f"from {e['from_username']}")
        if e.get("to_username"):
            parts.append(f"to {e['to_username']}")
        if e.get("price"):
            parts.append(f"${int(e['price']):,}")
        cname = e.get("car_name") or (catalog.get(e.get("car_id") or "") or {}).get("name") or e.get("car_id")
        summary = f"{EVENT_LABELS.get(et, et)} — {cname}"
        if parts:
            summary += f" ({', '.join(parts)})"
        for k in ("from_user_id", "to_user_id"):
            if e.get(k):
                user_ids.add(e[k])
        timeline.append(
            _timeline_row(
                at=e.get("at"),
                event_type=et,
                source="exclusive_car_events",
                summary=summary,
                user_car_id=e.get("user_car_id"),
                car_id=e.get("car_id"),
                details=e,
            )
        )

    # Marketplace trades
    trade_q: Dict[str, Any] = {"type": "car_trade", "car_id": {"$in": match_car_ids}}
    trade_ors: List[dict] = []
    if scope_user_id:
        trade_ors.append({"buyer_id": scope_user_id})
        trade_ors.append({"seller_id": scope_user_id})
    if user_car_ids:
        trade_ors.append({"user_car_id": {"$in": list(user_car_ids)}})
    if user_car_id and str(user_car_id).strip():
        trade_ors.append({"user_car_id": str(user_car_id).strip()})
    if trade_ors:
        trade_q["$or"] = trade_ors
    trades = await db.economy_events.find(trade_q, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    for t in trades:
        price = int(t.get("price") or 0)
        summary = f"Sold {t.get('car_name') or t.get('car_id')} — {t.get('seller_username', '?')} → {t.get('buyer_username', '?')} for ${price:,}"
        for k in ("buyer_id", "seller_id"):
            if t.get(k):
                user_ids.add(t[k])
        timeline.append(
            _timeline_row(
                at=t.get("at"),
                event_type="market_sale",
                source="economy_events",
                summary=summary,
                user_car_id=t.get("user_car_id"),
                car_id=t.get("car_id"),
                details=t,
            )
        )

    # Activity log: list / delist / buy
    act_actions = ["garage_list_car", "garage_buy_listed_car", "gta_delist"]
    act_q: Dict[str, Any] = {"action": {"$in": act_actions}}
    if scope_user_id:
        act_q["user_id"] = scope_user_id
    act_rows = await db.activity_log.find(act_q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    for a in act_rows:
        det = a.get("details") or {}
        cid = det.get("car_id")
        if cid and cid not in match_car_ids:
            continue
        if car_filter and cid != car_filter:
            continue
        action = a.get("action") or ""
        if action == "garage_list_car":
            et, summary = "market_listed", f"Listed {det.get('car_name') or cid} for ${int(det.get('sale_price') or 0):,}"
        elif action == "gta_delist":
            et, summary = "market_delisted", f"Delisted {cid} from marketplace"
        elif action == "garage_buy_listed_car":
            et = "market_sale"
            summary = f"Bought {det.get('car_name') or cid} from {det.get('seller_username', '?')} for ${int(det.get('price') or 0):,}"
            if det.get("seller_id"):
                user_ids.add(det["seller_id"])
        else:
            continue
        if a.get("user_id"):
            user_ids.add(a["user_id"])
        timeline.append(
            _timeline_row(
                at=a.get("created_at"),
                event_type=et,
                source="activity_log",
                summary=summary,
                user_car_id=det.get("user_car_id"),
                car_id=cid,
                details={"action": action, **det},
            )
        )

    # GTA wins
    gta_q: Dict[str, Any] = {"car_id": {"$in": match_car_ids}, "success": True}
    if scope_user_id:
        gta_q["user_id"] = scope_user_id
    gta_rows = await db.gta_events.find(gta_q, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    for g in gta_rows:
        if g.get("user_id"):
            user_ids.add(g["user_id"])
        cname = g.get("car_name") or catalog.get(g.get("car_id"), {}).get("name")
        timeline.append(
            _timeline_row(
                at=g.get("at"),
                event_type="gta_won",
                source="gta_events",
                summary=f"GTA win — {g.get('username', '?')} stole {cname} ({g.get('option_name', '')})",
                car_id=g.get("car_id"),
                details=g,
            )
        )

    # Loot box car21
    if not car_filter or car_filter == "car21":
        lb_q: Dict[str, Any] = {"type": "loot_box_open"}
        if scope_user_id:
            lb_q["user_id"] = scope_user_id
        lb_rows = await db.economy_events.find(lb_q, {"_id": 0, "rewards": 1, "at": 1, "user_id": 1, "username": 1}).sort("at", -1).limit(limit).to_list(limit)
        for lb in lb_rows:
            car_rewards = [r for r in (lb.get("rewards") or []) if r.get("type") == "car" and (r.get("id") == "car21" or r.get("car_id") == "car21")]
            if not car_rewards:
                continue
            if lb.get("user_id"):
                user_ids.add(lb["user_id"])
            timeline.append(
                _timeline_row(
                    at=lb.get("at"),
                    event_type="loot_box",
                    source="economy_events",
                    summary=f"Loot box — {lb.get('username', '?')} won loot-exclusive car",
                    car_id="car21",
                    details=lb,
                )
            )

    # PvP kills (cars taken — may include exclusives; id may have changed after transfer)
    atk_q: Dict[str, Any] = {"outcome": "killed"}
    if scope_user_id:
        atk_q["$or"] = [{"attacker_id": scope_user_id}, {"target_id": scope_user_id}]
    atk_rows = await db.attack_attempts.find(
        atk_q,
        {"_id": 0, "created_at": 1, "attacker_id": 1, "attacker_username": 1, "target_id": 1, "target_username": 1, "rewards": 1},
    ).sort("created_at", -1).limit(min(limit, 150)).to_list(150)
    for atk in atk_rows:
        rewards = atk.get("rewards") or {}
        cars_taken = int(rewards.get("cars_taken") or 0)
        if cars_taken <= 0:
            continue
        aid, tid = atk.get("attacker_id"), atk.get("target_id")
        if aid:
            user_ids.add(aid)
        if tid:
            user_ids.add(tid)
        if scope_user_id == aid:
            et = "pvp_kill_transfer"
            summary = f"Kill — took {cars_taken} car(s) from {atk.get('target_username', '?')} (may include exclusive; garage id rotated on transfer)"
        elif scope_user_id == tid:
            et = "pvp_kill_lost"
            summary = f"Killed by {atk.get('attacker_username', '?')} — {cars_taken} car(s) taken (exclusive ids rotate on transfer)"
        else:
            et = "pvp_kill_transfer"
            summary = f"{atk.get('attacker_username', '?')} killed {atk.get('target_username', '?')} — {cars_taken} car(s) taken"
        timeline.append(
            _timeline_row(
                at=atk.get("created_at"),
                event_type=et,
                source="attack_attempts",
                summary=summary,
                details=atk,
            )
        )

    # Family war wipes with exclusive car prizes
    war_q: Dict[str, Any] = {"prize_exclusive_cars": {"$gt": 0}}
    war_rows = await db.family_wars.find(
        war_q,
        {"_id": 0, "id": 1, "ended_at": 1, "winner_family_id": 1, "loser_family_id": 1, "winner_family_name": 1, "loser_family_name": 1, "prize_exclusive_cars": 1, "wiped_by_killer_username": 1},
    ).sort("ended_at", -1).limit(80).to_list(80)
    for w in war_rows:
        if scope_user_id:
            from routers.game.families import resolve_family_id

            uf = await resolve_family_id(scope_user_id)
            if uf not in (w.get("winner_family_id"), w.get("loser_family_id")):
                continue
        n = int(w.get("prize_exclusive_cars") or 0)
        summary = f"War wipe — {n} exclusive car(s) from {w.get('loser_family_name', '?')} → winner boss ({w.get('winner_family_name', '?')})"
        if w.get("wiped_by_killer_username"):
            summary += f" (triggered by kill from {w['wiped_by_killer_username']})"
        timeline.append(
            _timeline_row(
                at=w.get("ended_at"),
                event_type="war_family_wipe",
                source="family_wars",
                summary=summary,
                details=w,
            )
        )

    timeline = _dedupe_timeline(timeline)[:limit]

    unames = await _username_map(db, user_ids)
    instances: List[dict] = []
    for uc in instances_raw:
        cid = uc.get("car_id")
        info = catalog.get(cid) or {}
        oid = uc.get("user_id")
        war = await _war_lock_for_user(db, oid) if oid else None
        inst = {
            "user_car_id": uc.get("id"),
            "car_id": cid,
            "car_name": uc.get("custom_name") or uc.get("car_name") or info.get("name") or cid,
            "rarity": info.get("rarity"),
            "catalog_value": info.get("value"),
            "owner_user_id": oid,
            "owner_username": unames.get(oid, "?"),
            "acquired_at": uc.get("acquired_at"),
            "listed_for_sale": bool(uc.get("listed_for_sale")),
            "sale_price": int(uc.get("sale_price") or 0) if uc.get("listed_for_sale") else None,
            "listed_at": uc.get("listed_at"),
            **(war or {"war_locked": False}),
        }
        # Per-instance timeline subset
        ucid = str(uc.get("id") or "")
        inst["timeline"] = [
            t for t in timeline
            if t.get("user_car_id") == ucid
            or (t.get("details") or {}).get("user_car_id") == ucid
        ][:50]
        instances.append(inst)

    notes = [
        "Timelines merge exclusive_car_events (new), economy_events, activity_log, gta_events, attack_attempts, and family_wars.",
        "PvP kills and war wipes assign a new user_car_id — older marketplace links may not chain automatically.",
        "War lock shows current family war status only (exclusive cars cannot be listed/scrapped/melted while at war).",
    ]

    return {
        "query": {
            "user_car_id": user_car_id,
            "car_id": car_filter or "all",
            "username": username,
            "limit": limit,
        },
        "instances": instances,
        "timeline": timeline,
        "notes": notes,
    }
