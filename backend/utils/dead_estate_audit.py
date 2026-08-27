"""Staff scan: dead accounts that still hold points / cash / Swiss, grouped onto a living player."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from utils.staff_email_history import _clean_email

CASH_PERCENT_DEFAULT = 0.9995
MAX_LEFTOVER_DEAD = 2500
MAX_USERNAME_CANDIDATES = 300
# If this many living accounts share a registration IP, do not treat it as a respawn link.
IP_ALIVE_NOISE = 4
IP_AFTER_DEATH_MAX_HITS = 3

DEAD_ESTATE_PROJ = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "email": 1,
    "email_before_freed": 1,
    "is_dead": 1,
    "dead_at": 1,
    "created_at": 1,
    "points": 1,
    "money_at_death": 1,
    "swiss_balance": 1,
    "swiss_retrieval_used": 1,
    "retrieval_used": 1,
    "account_locked": 1,
    "revive_sacrifice": 1,
    "modkill_wipe": 1,
    "registration_ip": 1,
    "last_login_ip": 1,
    "registration_freed_email_from_user_id": 1,
}


def leftover_mongo_filter() -> Dict[str, Any]:
    return {
        "is_dead": True,
        "is_npc": {"$ne": True},
        "$or": [
            {"points": {"$gt": 0}},
            {"$and": [{"swiss_balance": {"$gt": 0}}, {"swiss_retrieval_used": {"$ne": True}}]},
            {"$and": [{"retrieval_used": {"$ne": True}}, {"money_at_death": {"$gt": 0}}]},
        ],
    }


def _reg_ip(user: Optional[dict]) -> str:
    return str((user or {}).get("registration_ip") or "").strip()


def _user_emails(user: Optional[dict]) -> Set[str]:
    out: Set[str] = set()
    if not user:
        return out
    for key in ("email", "email_before_freed"):
        em = _clean_email(user.get(key))
        if em:
            out.add(em)
    return out


def serialize_dead_estate(user: Optional[dict], *, cash_percent: float = CASH_PERCENT_DEFAULT) -> Optional[Dict[str, Any]]:
    if not user or not user.get("is_dead") or user.get("is_npc"):
        return None
    from routers.game.dead_alive import estate_retrievable

    estate = estate_retrievable(user, cash_percent=float(cash_percent))
    if not estate.get("can_retrieve"):
        return None
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "dead_at": user.get("dead_at"),
        "created_at": user.get("created_at"),
        "email": _clean_email(user.get("email")),
        "email_before_freed": _clean_email(user.get("email_before_freed")),
        "retrieval_used": bool(user.get("retrieval_used")),
        "swiss_retrieval_used": bool(user.get("swiss_retrieval_used")),
        "account_locked": bool(user.get("account_locked")),
        "points": int(estate["points"]),
        "cash": int(estate["cash"]),
        "cash_before_tithe": int(estate["cash_before_tithe"]),
        "swiss": int(estate["swiss"]),
    }


def _live_snapshot(user: dict) -> Dict[str, Any]:
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "email": _clean_email(user.get("email")),
        "created_at": user.get("created_at"),
    }


def pick_alive_for_dead(
    dead: dict,
    live_users: List[dict],
    noisy_ips: Set[str],
) -> Tuple[Optional[dict], Optional[str]]:
    dead_id = dead.get("id")
    dead_emails = _user_emails(dead)

    email_hits = [
        u for u in live_users
        if u.get("id") != dead_id and _clean_email(u.get("email")) in dead_emails
    ]
    if email_hits:
        email_hits.sort(key=lambda u: str(u.get("created_at") or ""), reverse=True)
        return email_hits[0], "same_email"

    repl = [
        u for u in live_users
        if (u.get("registration_freed_email_from_user_id") or "").strip() == dead_id
    ]
    if repl:
        repl.sort(key=lambda u: str(u.get("created_at") or ""))
        return repl[0], "replacement_registration"

    rip = _reg_ip(dead)
    if not rip or rip in noisy_ips:
        return None, None
    dead_at = str(dead.get("dead_at") or "")
    ip_hits = [
        u for u in live_users
        if u.get("id") != dead_id
        and _reg_ip(u) == rip
        and (not dead_at or str(u.get("created_at") or "") >= dead_at)
    ]
    if 1 <= len(ip_hits) <= IP_AFTER_DEATH_MAX_HITS:
        ip_hits.sort(key=lambda u: str(u.get("created_at") or ""))
        return ip_hits[0], "registration_ip_after_death"
    return None, None


def _totals(rows: List[dict]) -> Dict[str, int]:
    return {
        "points": sum(int(r.get("points") or 0) for r in rows),
        "cash": sum(int(r.get("cash") or 0) for r in rows),
        "swiss": sum(int(r.get("swiss") or 0) for r in rows),
        "dead_count": len(rows),
    }


def build_dead_estate_clusters(
    leftover_deads: List[dict],
    live_users: List[dict],
    *,
    cash_percent: float = CASH_PERCENT_DEFAULT,
) -> Dict[str, Any]:
    ip_counts: Dict[str, int] = defaultdict(int)
    for u in live_users:
        rip = _reg_ip(u)
        if rip:
            ip_counts[rip] += 1
    noisy_ips = {ip for ip, n in ip_counts.items() if n >= IP_ALIVE_NOISE}

    by_alive: Dict[str, Dict[str, Any]] = {}
    unlinked: List[dict] = []

    for dead in leftover_deads:
        row = serialize_dead_estate(dead, cash_percent=cash_percent)
        if not row:
            continue
        alive, reason = pick_alive_for_dead(dead, live_users, noisy_ips)
        row["link_reason"] = reason
        if not alive or not alive.get("id"):
            unlinked.append(row)
            continue
        aid = alive["id"]
        bucket = by_alive.get(aid)
        if not bucket:
            bucket = {"current": _live_snapshot(alive), "dead_accounts": []}
            by_alive[aid] = bucket
        bucket["dead_accounts"].append(row)

    clusters = []
    for bucket in by_alive.values():
        deads = bucket["dead_accounts"]
        deads.sort(key=lambda r: str(r.get("dead_at") or ""), reverse=True)
        clusters.append({
            "current": bucket["current"],
            "dead_accounts": deads,
            "totals": _totals(deads),
        })
    clusters.sort(
        key=lambda c: (
            -int(c["totals"]["points"]),
            -int(c["totals"]["cash"]),
            -int(c["totals"]["swiss"]),
            str((c.get("current") or {}).get("username") or "").lower(),
        )
    )
    unlinked.sort(key=lambda r: (-int(r.get("points") or 0), -int(r.get("cash") or 0), str(r.get("username") or "").lower()))

    all_dead = [d for c in clusters for d in c["dead_accounts"]] + unlinked
    return {
        "clusters": clusters,
        "unlinked": unlinked,
        "summary": {
            **_totals(all_dead),
            "player_count": len(clusters),
            "unlinked_count": len(unlinked),
        },
    }


def _seed_ips(seed: dict) -> List[str]:
    out = []
    for key in ("registration_ip", "last_login_ip"):
        v = str(seed.get(key) or "").strip()
        if v and v not in out:
            out.append(v)
    return out


async def scan_dead_estates(
    db,
    *,
    seed_user: Optional[dict] = None,
    cash_percent: float = CASH_PERCENT_DEFAULT,
    limit: int = MAX_LEFTOVER_DEAD,
) -> Dict[str, Any]:
    from utils.account_compare_lineage import collect_email_lineage_accounts

    limit = max(1, min(int(limit or MAX_LEFTOVER_DEAD), MAX_LEFTOVER_DEAD))
    leftover_deads: List[dict]
    extra_lives: List[dict] = []

    if seed_user and seed_user.get("id"):
        lineage = await collect_email_lineage_accounts(db, seed_user, limit=40)
        related_ids = [r.get("id") for r in (lineage.get("related_accounts") or []) if r.get("id")]
        emails = set(_user_emails(seed_user))
        related_rows = []
        if related_ids:
            related_rows = await db.users.find(
                {"id": {"$in": related_ids}},
                DEAD_ESTATE_PROJ,
            ).to_list(len(related_ids))
        for row in related_rows:
            emails |= _user_emails(row)
        emails = sorted(emails)
        or_clauses: List[Dict[str, Any]] = []
        if related_ids:
            or_clauses.append({"id": {"$in": related_ids}})
        if emails:
            or_clauses.append({"email": {"$in": emails}})
            or_clauses.append({"email_before_freed": {"$in": emails}})
        seed_ips = _seed_ips(seed_user)
        if seed_ips:
            or_clauses.append({"registration_ip": {"$in": seed_ips}})
        if not or_clauses:
            or_clauses.append({"id": seed_user["id"]})
        candidates = await db.users.find(
            {"is_npc": {"$ne": True}, "$or": or_clauses},
            DEAD_ESTATE_PROJ,
        ).to_list(MAX_USERNAME_CANDIDATES)
        leftover_deads = [u for u in candidates if serialize_dead_estate(u, cash_percent=cash_percent)]
        extra_lives = [u for u in candidates if not u.get("is_dead")]
        if seed_user.get("id") not in {u.get("id") for u in extra_lives} and not seed_user.get("is_dead"):
            extra_lives.append(seed_user)
    else:
        leftover_deads = await db.users.find(leftover_mongo_filter(), DEAD_ESTATE_PROJ).to_list(limit)
        leftover_deads = [u for u in leftover_deads if serialize_dead_estate(u, cash_percent=cash_percent)]

    emails: Set[str] = set()
    dead_ids: List[str] = []
    ips: Set[str] = set()
    for d in leftover_deads:
        emails |= _user_emails(d)
        if d.get("id"):
            dead_ids.append(d["id"])
        rip = _reg_ip(d)
        if rip:
            ips.add(rip)

    live_or: List[Dict[str, Any]] = []
    if emails:
        live_or.append({"email": {"$in": sorted(emails)}})
    if dead_ids:
        live_or.append({"registration_freed_email_from_user_id": {"$in": dead_ids}})
    if ips:
        live_or.append({"registration_ip": {"$in": sorted(ips)}})

    live_users: List[dict] = list(extra_lives)
    seen_live = {u.get("id") for u in live_users if u.get("id")}
    if live_or:
        fetched = await db.users.find(
            {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "$or": live_or},
            DEAD_ESTATE_PROJ,
        ).to_list(5000)
        for u in fetched:
            uid = u.get("id")
            if uid and uid not in seen_live:
                seen_live.add(uid)
                live_users.append(u)

    payload = build_dead_estate_clusters(leftover_deads, live_users, cash_percent=cash_percent)
    if seed_user:
        payload["query"] = {
            "username": seed_user.get("username"),
            "id": seed_user.get("id"),
            "is_dead": bool(seed_user.get("is_dead")),
        }
    else:
        payload["query"] = None
    payload["summary"]["scanned_dead"] = len(leftover_deads)
    return payload
