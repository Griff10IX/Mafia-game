"""Credit Ambush 50% pack-rate loot for £50 Custom (28 Aug) + System AI helpdesk reply."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "9499a1ea-bf2e-46fe-a3c0-e9506491b83e"
TICKET_ID = "ff9f3888-06d5-4831-81c4-7f10c0332971"
SESSION_ID = "cs_live_a1P4q8qNNisgO5FWZx7j1gmLOMBZD4ZGrfsIyagyL68YDJwlvyt8lGzumH"
MARK = "goodwill_loot_50pct_outside_24h_at"
PACK_PIECES = 1000
PACK_GBP_MINOR = 700
PENCE = 5000
GRANT = (PENCE * PACK_PIECES) // PACK_GBP_MINOR  # 7142
HALF = GRANT // 2  # 3571

BODY = (
    "Ambush,\n\n"
    "The extra loot pieces from the store-rate change only applied to card purchases "
    "made in the last 24 hours. Your Custom points buy on 28 August was outside that "
    "window, so it did not get the full top-up.\n\n"
    f"For the inconvenience we have credited {HALF:,} loot pieces to your account — "
    "half of the current pack rate on that £50 purchase, rather than the full amount.\n\n"
    "— System AI"
)

now_iso = datetime.now(timezone.utc).isoformat()

txn = db.payment_transactions.find_one({"session_id": SESSION_ID})
if not txn:
    raise SystemExit("payment missing")
if txn.get(MARK):
    print("already credited", txn.get(MARK), "grant", txn.get("goodwill_loot_pieces"))
else:
    db.users.update_one({"id": UID}, {"$inc": {"loot_box_pieces": HALF}})
    db.payment_transactions.update_one(
        {"session_id": SESSION_ID},
        {"$set": {MARK: now_iso, "goodwill_loot_pieces": HALF}},
    )
    u = db.users.find_one({"id": UID}, {"_id": 0, "loot_box_pieces": 1})
    print("credited", HALF, "loot now", (u or {}).get("loot_box_pieces"))

ticket = db.help_desk_tickets.find_one({"id": TICKET_ID})
if not ticket:
    raise SystemExit("ticket missing")
already = any((r.get("system_ai") or r.get("author_role") == "system_ai") for r in (ticket.get("replies") or []))
if already:
    print("system AI reply already on ticket")
else:
    db.help_desk_tickets.update_one(
        {"id": TICKET_ID},
        {
            "$push": {
                "replies": {
                    "author_id": "system_ai",
                    "author_username": "System AI",
                    "author_role": "system_ai",
                    "body": BODY,
                    "created_at": now_iso,
                    "system_ai": True,
                    "avatar_url": "/images/system-ai-avatar.png",
                }
            },
            "$set": {"updated_at": now_iso},
        },
    )
    print("helpdesk reply added")
print("done")
