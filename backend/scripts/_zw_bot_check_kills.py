"""Deep bot-check for Zwischenzug across all evidence collections."""
from datetime import datetime, timedelta, timezone
from _system_ai_prank_helpers import db

ZID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
ZUN = "Zwischenzug"
since72 = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()

print("=== 1. BOT CLIENT BLOCK EVENTS (all time) ===")
total_blocks = db.bot_client_block_events.count_documents({"user_id": ZID})
blocks = list(db.bot_client_block_events.find(
    {"user_id": ZID},
    {"_id": 0, "created_at": 1, "path": 1, "reason": 1, "source": 1, "user_agent_short": 1, "ip": 1, "extra": 1}
).sort("created_at", -1).limit(30))
print(f"Total blocks ever: {total_blocks}")
for b in blocks:
    print(f"  {str(b.get('created_at',''))[:19]} | {b.get('path','')} | reason={b.get('reason','')} | src={b.get('source','')} | ua={b.get('user_agent_short','')[:60]}")

print("\n=== 2. ATTACK CLIENT AUDIT (all events) ===")
audits = list(db.attack_client_audit.find(
    {"user_id": ZID},
    {"_id": 0, "created_at": 1, "event": 1, "attack_id": 1, "target_username": 1,
     "attacker_is_bot": 1, "client_anomaly_flags": 1, "attacker_client_signal": 1,
     "user_agent": 1, "client_header_snapshot": 1}
).sort("created_at", -1).limit(50))
print(f"Total audit events: {len(audits)}")
for a in audits[:20]:
    print(f"  {str(a.get('created_at',''))[:19]} | {a.get('event','')} | bot={a.get('attacker_is_bot')} | flags={a.get('client_anomaly_flags')} | signal={str(a.get('attacker_client_signal',''))[:40]}")
    if a.get('user_agent'):
        print(f"    UA: {a.get('user_agent','')[:100]}")
    if a.get('client_header_snapshot'):
        print(f"    headers: {str(a.get('client_header_snapshot'))[:150]}")

print("\n=== 3. ATTACK ATTEMPTS TIMING (last 72h) ===")
atts = list(db.attack_attempts.find(
    {"attacker_id": ZID, "created_at": {"$gte": since72}},
    {"_id": 0, "created_at": 1, "target_username": 1, "success": 1,
     "user_agent": 1, "client_ip": 1}
).sort("created_at", 1))
print(f"Total attempts (72h): {len(atts)}")
times = []
for a in atts:
    raw = a.get("created_at","")
    try:
        t = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw).replace("Z","+00:00"))
        times.append(t)
    except Exception:
        pass
    ua = (a.get("user_agent") or "")[:80]
    print(f"  {str(raw)[:19]} | {a.get('target_username','?'):20} | ok={a.get('success')} | ua={ua}")

if len(times) > 1:
    gaps = [(times[i+1]-times[i]).total_seconds() for i in range(len(times)-1)]
    print(f"\n  GAPS => min={min(gaps):.1f}s  max={max(gaps):.1f}s  avg={sum(gaps)/len(gaps):.1f}s")
    print(f"  <5s: {len([g for g in gaps if g<5])}  <15s: {len([g for g in gaps if g<15])}  <60s: {len([g for g in gaps if g<60])}")

print("\n=== 4. SUSPICIOUS LOGINS ===")
sl = list(db.suspicious_logins.find({"user_id": ZID}, {"_id": 0}).sort("created_at", -1).limit(10))
print(f"Count: {len(sl)}")
for s in sl:
    print(f"  {str(s.get('created_at',''))[:19]} | {str(s)[:150]}")

print("\n=== 5. USER BOT/BLOCK FIELDS ===")
u = db.users.find_one({"id": ZID}, {"_id": 0})
keys_interest = [k for k in (u or {}) if any(x in k.lower() for x in ("bot","block","flag","suspect","cheat","script","agent","login","device","ip","ban"))]
for k in sorted(keys_interest):
    print(f"  {k}: {u[k]}")
