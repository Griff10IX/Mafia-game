"""5545 bodyguard activity / botting check for today (UTC day + last 24h)."""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean, median

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^5545$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "is_dead": 1,
        "current_state": 1,
        "last_seen": 1,
        "total_kills": 1,
        "robot_bodyguard_kills": 1,
    },
)
print("USER", u)
uid = u["id"]
uname = u["username"]

now = datetime.now(timezone.utc)
# "today" UK roughly = UTC+1 so UK midnight ~ 23:00 prev UTC; use UK calendar day Sep 6
# User said "overall today" — use last 24h + UTC calendar day Sep 5/6 window
day_start_utc = datetime(2026, 9, 5, 23, 0, 0)  # ~ Sep 6 00:00 UK
if now.hour >= 23:
    # if somehow later
    pass
# Also report full UTC Sep 5 and Sep 6 so far
windows = {
    "UK_today_from_midnight": day_start_utc,
    "last_6h": now - timedelta(hours=6),
    "last_24h": now - timedelta(hours=24),
    "since_sep5_00utc": datetime(2026, 9, 5, 0, 0, 0),
}


def as_dt(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def gap_stats(times):
    times = sorted(t for t in times if t)
    if len(times) < 2:
        return None
    gaps = [(times[i] - times[i - 1]).total_seconds() for i in range(1, len(times))]
    sub1 = sum(1 for g in gaps if g < 1.0)
    sub0_5 = sum(1 for g in gaps if g < 0.5)
    sub0_2 = sum(1 for g in gaps if g < 0.2)
    return {
        "n_gaps": len(gaps),
        "min": round(min(gaps), 3),
        "p50": round(median(gaps), 3),
        "mean": round(mean(gaps), 3),
        "sub1s": sub1,
        "sub0_5s": sub0_5,
        "sub0_2s": sub0_2,
        "sub1s_pct": round(100.0 * sub1 / len(gaps), 1),
    }


# Resolve which targets are bodyguards (npc / in bodyguards collection)
def is_bg_target(target_id, target_username, cache):
    key = target_id or target_username
    if key in cache:
        return cache[key]
    ok = False
    if target_id:
        bg = db.bodyguards.find_one({"bodyguard_user_id": target_id}, {"_id": 1})
        if bg:
            ok = True
        else:
            tu = db.users.find_one({"id": target_id}, {"_id": 0, "is_npc": 1, "is_bodyguard": 1})
            if tu and (tu.get("is_bodyguard") or tu.get("is_npc")):
                ok = True
    if not ok and target_username:
        # robot-style name often camel+hex
        tu = db.users.find_one(
            {"username": {"$regex": f"^{re.escape(target_username)}$", "$options": "i"}},
            {"_id": 0, "id": 1, "is_npc": 1, "is_bodyguard": 1},
        )
        if tu and (tu.get("is_bodyguard") or tu.get("is_npc")):
            ok = True
        elif tu:
            bg = db.bodyguards.find_one({"bodyguard_user_id": tu["id"]}, {"_id": 1})
            ok = bool(bg)
    cache[key] = ok
    return ok


print("\n=== ACTIVE SEARCHES NOW ===")
hunts = list(
    db.attacks.find(
        {"attacker_id": uid, "status": {"$in": ["searching", "found", "traveling"]}},
        {
            "_id": 0,
            "target_username": 1,
            "target_id": 1,
            "status": 1,
            "note": 1,
            "search_started": 1,
            "found_at": 1,
            "location_state": 1,
        },
    )
)
print(f"count={len(hunts)}")
bg_cache = {}
for h in hunts:
    bg = is_bg_target(h.get("target_id"), h.get("target_username"), bg_cache)
    print(
        f"  {'BG' if bg else 'PL'} {h.get('status'):10} {h.get('target_username'):30} "
        f"note={h.get('note')} loc={h.get('location_state')} found_at={h.get('found_at')}"
    )

for label, since in windows.items():
    since_n = since.replace(tzinfo=None) if since.tzinfo else since
    # attack_attempts often naive
    q = {
        "attacker_id": uid,
        "$or": [
            {"created_at": {"$gte": since}},
            {"created_at": {"$gte": since_n}},
            {"created_at": {"$gte": since.isoformat()}},
        ],
    }
    # simpler: fetch by naive since
    rows = list(
        db.attack_attempts.find(
            {"attacker_id": uid, "created_at": {"$gte": since_n}},
            {
                "_id": 0,
                "created_at": 1,
                "target_username": 1,
                "target_id": 1,
                "outcome": 1,
                "player_message": 1,
                "bodyguard_owner_id": 1,
                "blocking_bodyguard_user_id": 1,
                "first_bodyguard": 1,
            },
        ).sort("created_at", 1)
    )
    # de-dupe if double match unlikely with single query
    outcomes = Counter()
    bg_outcomes = Counter()
    player_outcomes = Counter()
    by_target = Counter()
    bg_times = []
    all_times = []
    bg_by_hour = Counter()
    for r in rows:
        t = as_dt(r.get("created_at"))
        if t and t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        if t and t < since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since:
            # if since was aware
            pass
        out = r.get("outcome") or "?"
        outcomes[out] += 1
        tn = r.get("target_username") or "?"
        tid = r.get("target_id")
        bg = bool(r.get("bodyguard_owner_id") or r.get("blocking_bodyguard_user_id")) or is_bg_target(
            tid, tn, bg_cache
        )
        # outcome bodyguard means hitting a protected player OR killing a bg? bodyguard = blocked by bg
        # For "botting bodyguards" user means hunting/executing on BG NPCs
        if out == "bodyguard":
            # blocked by someone's BG — not necessarily targeting a BG
            pass
        if bg or out in ("killed",) and is_bg_target(tid, tn, bg_cache):
            bg_outcomes[out] += 1
            by_target[tn] += 1
            if t:
                bg_times.append(t)
                bg_by_hour[t.strftime("%Y-%m-%d %H")] += 1
        else:
            player_outcomes[out] += 1
        if t:
            all_times.append(t)

    print(f"\n=== ATTEMPTS {label} since={since.isoformat()} n={len(rows)} ===")
    print(f"outcomes_all={dict(outcomes)}")
    print(f"outcomes_on_BG_targets={dict(bg_outcomes)} n_bg_attempts={sum(bg_outcomes.values())}")
    print(f"outcomes_on_players/other={dict(player_outcomes)}")
    print(f"gap_stats_ALL={gap_stats(all_times)}")
    print(f"gap_stats_BG_targets={gap_stats(bg_times)}")
    print("top BG targets:")
    for name, c in by_target.most_common(15):
        print(f"  {c:4d}  {name}")
    if bg_by_hour:
        print("BG attempts by hour UTC:")
        for h, c in sorted(bg_by_hour.items()):
            print(f"  {h}: {c}")

# Recent 30 attempts detail
print("\n=== MOST RECENT 40 ATTEMPTS ===")
recent = list(
    db.attack_attempts.find(
        {"attacker_id": uid},
        {
            "_id": 0,
            "created_at": 1,
            "target_username": 1,
            "target_id": 1,
            "outcome": 1,
            "player_message": 1,
            "bodyguard_owner_id": 1,
        },
    )
    .sort("created_at", -1)
    .limit(40)
)
for r in reversed(recent):
    tn = r.get("target_username")
    bg = is_bg_target(r.get("target_id"), tn, bg_cache)
    msg = (r.get("player_message") or "")[:50]
    print(f"  {r.get('created_at')}  {'BG' if bg else 'PL'}  {r.get('outcome'):12}  {tn}  {msg}")

# BG kills credited today
print("\n=== HITLIST bodyguard_killed where killer=5545 ===")
for label, since in [("UK_today", day_start_utc), ("last_24h", now - timedelta(hours=24))]:
    since_n = since.replace(tzinfo=None)
    kills = list(
        db.hitlist_bodyguard_events.find(
            {
                "type": "bodyguard_killed",
                "$or": [{"killer_id": uid}, {"killer_username": {"$regex": "^5545$", "$options": "i"}}],
                "at": {"$gte": since_n},
            },
            {"_id": 0, "at": 1, "guard_username": 1, "owner_username": 1, "hire_cost": 1, "bullets_used": 1},
        ).sort("at", 1)
    )
    print(f"{label}: kills={len(kills)}")
    for k in kills[-20:]:
        print(f"  {k.get('at')}  guard={k.get('guard_username')} owner={k.get('owner_username')} bullets={k.get('bullets_used')}")

# Own bodyguard hires today
print("\n=== 5545 OWN BG HIRES (today-ish) ===")
hires = list(
    db.hitlist_bodyguard_events.find(
        {"owner_id": uid, "type": "bodyguard_hired", "at": {"$gte": datetime(2026, 9, 5, 0, 0, 0)}},
        {"_id": 0, "at": 1, "slot": 1, "hire_cost": 1, "bodyguard_username": 1, "staff_topup": 1, "used_hire_token": 1},
    ).sort("at", 1)
)
for h in hires:
    print(h)

# Activity signals: last_seen, travels, crimes rough
print("\n=== ACTIVITY SIGNALS last 24h ===")
since24 = (now - timedelta(hours=24)).replace(tzinfo=None)
for coll, field, who in [
    ("activity_logs", "created_at", "user_id"),
    ("user_activity", "at", "user_id"),
]:
    try:
        n = db[coll].count_documents({who: uid, field: {"$gte": since24}})
        print(f"  {coll}: {n}")
    except Exception as e:
        print(f"  {coll}: err {e}")

# attack list search starts today
searches_started = list(
    db.attacks.find(
        {
            "attacker_id": uid,
            "search_started": {"$gte": datetime(2026, 9, 5, 0, 0, 0).isoformat()},
        },
        {"_id": 0, "target_username": 1, "note": 1, "search_started": 1, "status": 1, "search_source": 1},
    ).sort("search_started", 1)
)
print(f"\n=== SEARCHES STARTED since Sep5 UTC: {len(searches_started)} ===")
for s in searches_started:
    print(
        f"  {s.get('search_started')}  {s.get('status'):10}  {s.get('target_username')}  "
        f"note={s.get('note')} src={s.get('search_source')}"
    )

# Burst detect: max attempts in any 10s / 60s window on BG targets
print("\n=== BG BURST (best windows last 24h) ===")
since24a = now - timedelta(hours=24)
rows24 = list(
    db.attack_attempts.find(
        {"attacker_id": uid, "created_at": {"$gte": since24a.replace(tzinfo=None)}},
        {"_id": 0, "created_at": 1, "target_username": 1, "target_id": 1, "outcome": 1},
    ).sort("created_at", 1)
)
bg_ts = []
for r in rows24:
    if is_bg_target(r.get("target_id"), r.get("target_username"), bg_cache):
        t = as_dt(r.get("created_at"))
        if t:
            bg_ts.append(t)
bg_ts.sort()
best10 = best60 = 0
j = 0
for i, t in enumerate(bg_ts):
    while j < len(bg_ts) and (bg_ts[j] - t).total_seconds() <= 10:
        j += 1
    best10 = max(best10, j - i)
j = 0
for i, t in enumerate(bg_ts):
    while j < len(bg_ts) and (bg_ts[j] - t).total_seconds() <= 60:
        j += 1
    best60 = max(best60, j - i)
print(f"bg_attempts_24h={len(bg_ts)} max_per_10s={best10} max_per_60s={best60}")
print(f"gap_bg_24h={gap_stats(bg_ts)}")
