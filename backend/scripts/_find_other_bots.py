"""Scan for other potential bots based on request patterns."""
import os
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

print("=" * 60)
print("BOT DETECTION SCAN")
print("=" * 60)

# Get last 10 minutes of logs
result = subprocess.run(
    ["journalctl", "-u", "mafia-backend", "--no-pager", "--since", "10 minutes ago"],
    capture_output=True, text=True
)

lines = result.stdout.split("\n")

# Count requests per user
user_requests = defaultdict(int)
user_endpoints = defaultdict(lambda: defaultdict(int))
user_timestamps = defaultdict(list)

# Parse logs
ts_pattern = r"(\d{2}:\d{2}:\d{2})"
user_pattern = r"(GET|POST) (/api/[^ ]+) \d+ (\w+)"

for line in lines:
    match = re.search(user_pattern, line)
    ts_match = re.search(ts_pattern, line)
    if match:
        method, endpoint, username = match.groups()
        user_requests[username] += 1
        user_endpoints[username][f"{method} {endpoint.split('?')[0]}"] += 1
        if ts_match:
            user_timestamps[username].append(ts_match.group(1))

print(f"\nAnalyzed {len(lines)} log lines from last 10 minutes\n")

# Sort by request count
sorted_users = sorted(user_requests.items(), key=lambda x: -x[1])

print("=== TOP 20 USERS BY REQUEST COUNT ===")
print(f"{'Username':<25} {'Requests':<10} {'Req/min':<10} {'Suspicious?'}")
print("-" * 60)

suspicious = []
for username, count in sorted_users[:20]:
    req_per_min = count / 10  # 10 minutes of data
    
    # Flag as suspicious if > 50 requests/minute
    is_suspicious = req_per_min > 50
    flag = "⚠️  YES" if is_suspicious else ""
    
    print(f"{username:<25} {count:<10} {req_per_min:<10.1f} {flag}")
    
    if is_suspicious and username not in ["GhostFace", "Thor", "System"]:  # Exclude staff
        suspicious.append((username, count, req_per_min))

# Analyze suspicious users
if suspicious:
    print(f"\n=== SUSPICIOUS USER ANALYSIS ===")
    for username, count, rpm in suspicious:
        print(f"\n--- {username} ({rpm:.1f} req/min) ---")
        
        # Top endpoints
        endpoints = user_endpoints[username]
        print("Top endpoints:")
        for ep, cnt in sorted(endpoints.items(), key=lambda x: -x[1])[:5]:
            print(f"  {cnt:4d}x {ep}")
        
        # Timing analysis
        timestamps = user_timestamps[username]
        if len(timestamps) > 10:
            # Check for mechanical intervals
            intervals = []
            for i in range(1, min(50, len(timestamps))):
                t1 = timestamps[i-1]
                t2 = timestamps[i]
                # Simple second-level comparison
                if t1 != t2:
                    intervals.append(1)  # Different second
                else:
                    intervals.append(0)  # Same second (rapid)
            
            same_second = intervals.count(0)
            if same_second > len(intervals) * 0.3:
                print(f"  ⚠️  {same_second}/{len(intervals)} requests in same second (rapid fire)")
        
        # Check if hitting attack endpoints
        attack_hits = sum(c for ep, c in endpoints.items() if "attack" in ep.lower())
        if attack_hits > 100:
            print(f"  ⚠️  {attack_hits} attack-related requests")
else:
    print("\n✓ No obviously suspicious users detected")

# Also check for any bot_trap failures
print(f"\n=== BOT TRAP FAILURES (last 10 min) ===")
trap_fails = [l for l in lines if "bot_trap_fail" in l]
if trap_fails:
    fail_users = defaultdict(int)
    for l in trap_fails:
        match = re.search(r"user=(\w+)", l)
        if match:
            fail_users[match.group(1)] += 1
    
    for user, count in sorted(fail_users.items(), key=lambda x: -x[1]):
        print(f"  {user}: {count} failures 🤖")
else:
    print("  None")

print("\n" + "=" * 60)
