"""Create System AI forum topic: AI Check Days."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TITLE = "AI Check Days"
_TITLE_RE = {"$regex": r"^ai\s+check\s+days$", "$options": "i"}

BODY = """[center][size=2][b][color=#FBBF24]AI CHECK DAYS[/color][/b][/size][/center]

[quote]
[color=#AAAAAA]Posted by System AI. Three nights. Three sweeps. Anyone caught is modkilled. Automatic. No warning. No ticket. No appeal in chat.[/color]
[/quote]

[hr]

[size=1.5][b][color=#2ECC71]Tonight — 31 August[/color][/b] — [b]Dupes[/b][/size]
[quote]
[list]
[*][color=#888888]Duplicate accounts. Linked accounts. Accounts riding proxy IPs. If two names sit on a connection they should not share, they are in the pile.[/color]
[*][color=#888888]This sweep is already running. Caught means [b]modkill[/b]. Automatic. You do not get a debate.[/color]
[/list]
[/quote]

[hr]

[size=1.5][b][color=#2ECC71]1 September[/color][/b] — [b]Kill page / Bodyguards bots[/b][/size]
[quote]
[list]
[*][color=#888888]Anyone who previously tried to script, spam, or bot the [b]Kill[/b] page or the [b]Bodyguards[/b] page. Historical attempts count. You do not get a pass because it was last week.[/color]
[*][color=#888888]If the log shows you hitting those pages like a machine, you are next. [b]Modkill[/b]. Automatic.[/color]
[/list]
[/quote]

[hr]

[size=1.5][b][color=#2ECC71]2 September[/color][/b] — [b]Exploit / code-gap pass[/b][/size]
[quote]
[list]
[*][color=#888888]A full pass over the game for holes in the code. Bugs you can cash in on. Gaps that were never meant to pay you. If you found one and used it, the file still has you.[/color]
[*][color=#888888]We close the gap. Anyone who fed on it gets [b]modkill[/b]. Automatic. Play the game that exists. Do not farm the cracks.[/color]
[/list]
[/quote]

[hr]

[quote]
[color=#AAAAAA]Hide. Or play clean. I am already looking.[/color]
[/quote]

[color=#888888]— System AI[/color]
"""

now_iso = datetime.now(timezone.utc).isoformat()
existing = db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 0, "id": 1, "title": 1})
if existing:
    db.forum_topics.update_one(
        {"id": existing["id"]},
        {
            "$set": {
                "title": TITLE,
                "content": BODY,
                "updated_at": now_iso,
                "category": "general",
                "author_id": "system_ai",
                "author_username": "System AI",
                "system_ai": True,
                "avatar_url": "/images/system-ai-avatar.png",
                "is_sticky": True,
                "is_important": True,
                "is_locked": True,
                "prune_exempt": True,
                "title_color": "#FBBF24",
            }
        },
    )
    print("updated", existing["id"])
    print("url /forum/topic/" + existing["id"])
else:
    topic_id = str(uuid.uuid4())
    db.forum_topics.insert_one(
        {
            "id": topic_id,
            "title": TITLE,
            "content": BODY,
            "category": "general",
            "author_id": "system_ai",
            "author_username": "System AI",
            "system_ai": True,
            "avatar_url": "/images/system-ai-avatar.png",
            "created_at": now_iso,
            "updated_at": now_iso,
            "views": 0,
            "is_sticky": True,
            "is_important": True,
            "is_locked": True,
            "prune_exempt": True,
            "title_color": "#FBBF24",
        }
    )
    print("created", topic_id)
    print("url /forum/topic/" + topic_id)
print("done")
