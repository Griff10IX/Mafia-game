"""Vuse + Yama own robot bodyguard hire timing — botting check."""
import os
from datetime import datetime, timezone
from statistics import mean, median

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAMES = ["Vuse", "Yama"]
SINCE = datetime(2026, 9, 5, 0, 0, 0, tzinfo=timezone.utc)
WEEK = datetime(2026, 8, 29, 0, 0, 0, tzinfo=timezone.utc)


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


def gaps(times):
    times = sorted(t for t in times if t)
    if len(times) < 2:
        return None
    g = [(times[i] - times[i - 1]).total_seconds() for i in range(1, len(times))]
    return {
        "n": len(g),
        "min_s": round(min(g), 3),
        "p50_s": round(median(g), 3),
        "mean_s": round(mean(g), 3),
        "sub1s": sum(1 for x in g if x < 1),
        "sub2s": sum(1 for x in g if x < 2),
        "sub5s": sum(1 for x in g if x < 5),
    }


for name in NAMES:
    u = db.users.find_one(
        {"username": {"$regex": f"^{name}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "bodyguard_slots": 1, "robot_bodyguard_hire_tokens": 1, "last_seen": 1},
    )
    print(f"\n{'='*60}\nUSER {u}")
    if not u:
        continue
    uid = u["id"]

    hires = list(
        db.hitlist_bodyguard_events.find(
            {"owner_id": uid, "type": "bodyguard_hired", "is_robot": True},
            {
                "_id": 0,
                "at": 1,
                "slot": 1,
                "hire_cost": 1,
                "used_hire_token": 1,
                "bodyguard_username": 1,
                "staff_topup": 1,
                "restored_incident": 1,
                "inflation_level_before": 1,
            },
        ).sort("at", 1)
    )
    print(f"total_robot_hires_all_time={len(hires)}")

    today = []
    for h in hires:
        t = as_dt(h.get("at"))
        if t and t >= SINCE:
            today.append((t, h))

    print(f"\n=== HIRES since Sep 5 00:00 UTC ({len(today)}) ===")
    prev = None
    for t, h in today:
        delta = ""
        if prev:
            delta = f"  +{(t - prev).total_seconds():.3f}s"
        flag = ""
        if h.get("staff_topup"):
            flag = " STAFF"
        elif h.get("restored_incident"):
            flag = " RESTORE"
        tok = " TOKEN" if h.get("used_hire_token") else " PAID"
        print(
            f"  {t.isoformat()}  slot={h.get('slot')}{tok} cost={h.get('hire_cost')} "
            f"infl={h.get('inflation_level_before')} {h.get('bodyguard_username')}{flag}{delta}"
        )
        prev = t

    player = [(t, h) for t, h in today if not h.get("staff_topup") and not h.get("restored_incident")]
    print(f"\nplayer_hires_excl_staff/restore={len(player)} gaps={gaps([t for t,_ in player])}")

    # clusters
    cluster, clusters = [], []
    for t, h in player:
        if not cluster:
            cluster = [(t, h)]
            continue
        if (t - cluster[-1][0]).total_seconds() <= 120:
            cluster.append((t, h))
        else:
            if len(cluster) >= 2:
                clusters.append(cluster)
            cluster = [(t, h)]
    if len(cluster) >= 2:
        clusters.append(cluster)
    print("bulk_clusters_120s:")
    if not clusters:
        print("  (none)")
    for c in clusters:
        deltas = [(c[i][0] - c[i - 1][0]).total_seconds() for i in range(1, len(c))]
        costs = [int(h.get("hire_cost") or 0) for _, h in c]
        print(
            f"  n={len(c)} start={c[0][0].isoformat()} gaps_s={[round(d,3) for d in deltas]} "
            f"costs={costs} tokens={[bool(h.get('used_hire_token')) for _, h in c]} "
            f"names={[h.get('bodyguard_username') for _, h in c]}"
        )

    # ledger
    led = list(
        db.point_ledger_events.find(
            {"user_id": uid, "event_type": "bodyguard_hire", "created_at": {"$gte": SINCE.isoformat()}},
            {"_id": 0, "created_at": 1, "points": 1, "meta": 1},
        ).sort("created_at", 1)
    )
    print(f"ledger_hires_since_sep5={len(led)} gaps={gaps([as_dt(L.get('created_at')) for L in led])}")
    prev = None
    for L in led:
        t = as_dt(L.get("created_at"))
        d = f"  +{(t-prev).total_seconds():.3f}s" if prev and t else ""
        meta = L.get("meta") or {}
        print(f"  {L.get('created_at')} pts={L.get('points')} slot={meta.get('slot')} token={meta.get('used_hire_token')}{d}")
        prev = t

    week_player = []
    for h in hires:
        t = as_dt(h.get("at"))
        if t and t >= WEEK and not h.get("staff_topup") and not h.get("restored_incident"):
            week_player.append(t)
    sub2 = sum(
        1
        for i in range(1, len(week_player))
        if (week_player[i] - week_player[i - 1]).total_seconds() < 2
    )
    print(f"7d_player_hires={len(week_player)} gaps={gaps(week_player)} consec_under_2s={sub2}")

    bgs = list(
        db.bodyguards.find(
            {"user_id": uid},
            {"_id": 0, "slot_number": 1, "robot_name": 1, "hired_at": 1, "hire_cost": 1, "hired_with_token": 1},
        ).sort("slot_number", 1)
    )
    print(f"CURRENT BGs ({len(bgs)}):")
    for b in bgs:
        print(f"  {b}")
