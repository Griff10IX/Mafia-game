"""Inventory log-like collections: count, storage, oldest/newest, date types."""
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import db

NOW = datetime.now(timezone.utc)
CUT_14 = NOW - timedelta(days=14)
CUT_90 = NOW - timedelta(days=90)
CUT_180 = NOW - timedelta(days=180)

LOGGISH = [
    ("activity_log", "created_at"),
    ("gambling_log", "created_at"),
    ("analytics_events", "created_at"),
    ("attack_attempts", "created_at"),
    ("attack_client_audit", "created_at"),
    ("bot_client_block_events", "created_at"),
    ("admin_sustained_rl_events", "created_at"),
    ("captcha_turnstile_failures", "at"),
    ("hitlist_bodyguard_events", "at"),
    ("war_kill_feed", "created_at"),
    ("crime_events", "at"),
    ("gta_events", "at"),
    ("bust_events", "at"),
    ("respect_events", "at"),
    ("melt_events", "at"),
    ("economy_events", "at"),
    ("boxing_events", "at"),
    ("trade_events", "at"),
    ("stock_transactions", "created_at"),
    ("toast_events", "created_at"),
    ("minigame_play_payouts", "created_at"),
    ("admin_tool_access_events", "created_at"),
    ("security_logs", "created_at"),
    ("security_flags", "created_at"),
    ("endpoint_rl_violations", "at"),
    ("login_page_visits", "created_at"),
    ("suspicious_logins", "created_at"),
    ("game_chat_messages", "created_at"),
    ("public_kills", "created_at"),
    ("hitman_events", "created_at"),
    ("family_vault_transactions", "at"),
    ("family_racket_attacks", "created_at"),
    ("point_ledger_events", "created_at"),
    ("point_audit_events", "created_at"),
]


def to_dt(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


print(f"now {NOW.isoformat()}")
print(f"{'collection':32} {'n':>10} {'mb':>8} {'oldest':19} {'newest':19} {'typ':6} { '>14d':>8} {'>90d':>8} {'>180d':>8}")

for name, field in LOGGISH:
    coll = db[name]
    try:
        n = coll.estimated_document_count()
    except Exception as e:
        print(name, "ERR count", e)
        continue
    mb = "?"
    try:
        st = db.command("collStats", name, scale=1024 * 1024)
        mb = st.get("storageSize") or st.get("size") or "?"
    except Exception:
        pass
    if n == 0:
        print(f"{name:32} {n:10} {str(mb):>8} {'-':19} {'-':19}")
        continue
    oldest = coll.find_one({}, {field: 1}, sort=[(field, 1)])
    newest = coll.find_one({}, {field: 1}, sort=[(field, -1)])
    ov = (oldest or {}).get(field)
    nv = (newest or {}).get(field)
    typ = type(ov).__name__ if ov is not None else "?"
    od = to_dt(ov)
    nd = to_dt(nv)
    older14 = older90 = older180 = "?"
    try:
        if isinstance(ov, datetime):
            older14 = coll.count_documents({field: {"$lt": CUT_14}})
            older90 = coll.count_documents({field: {"$lt": CUT_90}})
            older180 = coll.count_documents({field: {"$lt": CUT_180}})
        elif isinstance(ov, str):
            older14 = coll.count_documents({field: {"$lt": CUT_14.isoformat()}})
            older90 = coll.count_documents({field: {"$lt": CUT_90.isoformat()}})
            older180 = coll.count_documents({field: {"$lt": CUT_180.isoformat()}})
    except Exception as e:
        older14 = str(e)[:20]
    print(
        f"{name:32} {n:10} {str(mb):>8} {(od.isoformat()[:19] if od else str(ov)[:19]):19} "
        f"{(nd.isoformat()[:19] if nd else str(nv)[:19]):19} {typ:6} {str(older14):>8} {str(older90):>8} {str(older180):>8}"
    )
