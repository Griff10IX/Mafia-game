"""Fetch TheSportsDB round 3 scores for LMS fix."""
import json
import urllib.request

url = "https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=4328&r=3"
with urllib.request.urlopen(url, timeout=30) as r:
    d = json.loads(r.read().decode())
for e in d.get("events") or []:
    print(
        f"{e.get('dateEvent')} | {e.get('strHomeTeam')} {e.get('intHomeScore')}-{e.get('intAwayScore')} "
        f"{e.get('strAwayTeam')} | status={e.get('strStatus')} id={e.get('idEvent')}"
    )
