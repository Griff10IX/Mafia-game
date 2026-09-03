"""Recent bullet-factory buys + bot-block hits. Report to console only."""
from collections import Counter
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import db

since = datetime.now(timezone.utc) - timedelta(hours=24)
print("=== armoury_buy_bullets last 24h ===")
q = {"action": "armoury_buy_bullets", "created_at": {"$gte": since}}
# created_at might be iso string
rows = list(db.activity_log.find({"action": "armoury_buy_bullets"}).sort("_id", -1).limit(80))
print("count_sample", len(rows))
by_user = Counter()
amounts = Counter()
times = []
for r in rows:
    un = r.get("username") or r.get("user_id")
    by_user[un] += 1
    d = (r.get("details") or {})
    amounts[d.get("amount")] += 1
    times.append((r.get("created_at"), un, d.get("amount"), d.get("state")))
    print(r.get("created_at"), un, d)

print("\n=== by user ===")
for u, n in by_user.most_common(15):
    print(n, u)

print("\n=== bot_client_block_events bullet/armoury ===")
for e in db.bot_client_block_events.find(
    {"$or": [
        {"path": {"$regex": "bullet-factory", "$options": "i"}},
        {"source": {"$regex": "bullet", "$options": "i"}},
    ]}
).sort("_id", -1).limit(10):
    print({k: e.get(k) for k in ("created_at", "username", "user_id", "path", "reason", "source")})
print("none" if db.bot_client_block_events.count_documents({"path": {"$regex": "bullet-factory", "$options": "i"}}) == 0 else "had hits")
