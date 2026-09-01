"""Keep chat-only insult names and cycle rainbow until stay end. No posts."""
import time
from datetime import datetime, timezone

from _system_ai_prank_helpers import RAINBOW_HEX, _pranks, paint, refresh_chat_names

END = datetime(2026, 9, 1, 0, 8, tzinfo=timezone.utc)
i = 0
while datetime.now(timezone.utc) < END:
    refresh_chat_names()
    pranks = _pranks()
    color = RAINBOW_HEX[i % len(RAINBOW_HEX)]
    for meta in pranks.values():
        name = (meta or {}).get("username")
        if name:
            paint(name, color, "cycle")
    print("refresh", i, datetime.now(timezone.utc).isoformat())
    i += 1
    time.sleep(10)
print("refresh loop end")
