"""Wake Cursor when GhostFace posts @system in game chat. One sentinel per new ping."""
import json
import re
import time
from datetime import datetime, timezone

from _system_ai_prank_helpers import GHOSTFACE_ID, db

PING = re.compile(r"@system\b", re.I)
seen = set()
beats = 0

for m in db.game_chat_messages.find(
    {"channel": "global", "user_id": GHOSTFACE_ID},
    {"id": 1},
).sort("created_at", -1).limit(300):
    seen.add(m["id"])

print(
    "wake watch start",
    datetime.now(timezone.utc).isoformat(),
    "seed",
    len(seen),
    flush=True,
)

while True:
    rows = list(
        db.game_chat_messages.find(
            {"channel": "global", "user_id": GHOSTFACE_ID},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .limit(12)
    )
    for m in reversed(rows):
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        text = (m.get("message") or "").replace("\n", " ").strip()
        if not PING.search(text):
            continue
        prompt = (
            "GhostFace pinged @system in game chat. Read "
            ".cursor/skills/system-ai-stay/SKILL.md. If you are already in a stay, "
            "follow this as a mid-stay order (mode / sleep / extras). If you are "
            "asleep, start a stay now from his line. Do not announce the wake watch. "
            f"His message: {text[:400]}"
        )
        print(
            "AGENT_LOOP_WAKE_system_ai_stay "
            + json.dumps(
                {"prompt": prompt, "message_id": mid, "text": text[:400]},
                ensure_ascii=True,
            ),
            flush=True,
        )
    if len(seen) > 800:
        seen = set(list(seen)[-400:])
    beats += 1
    if beats % 120 == 0:
        print("wake watch heartbeat", datetime.now(timezone.utc).isoformat(), flush=True)
    time.sleep(5)
