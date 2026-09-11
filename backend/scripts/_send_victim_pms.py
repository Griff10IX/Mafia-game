"""Send PMs to victims about point compensation + GhostFace preview."""
import os
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

SAI_AVATAR = "/images/system-ai-profile.jpg?v=5"

# Victims + points given
VICTIMS = [
    ("a58598e4-9bc1-49bc-b8a6-2b3007a7fcda", "Crosis", 71929),
    ("ccabedb7-e6bd-4b7c-bd59-d0d7053f80c2", "Rabbit", 71927),
    ("ff620eef-283a-4016-a172-d33854bcee7b", "Highlights", 71927),
    ("8b633f4f-b687-45be-a558-f554365fbb9e", "xemon", 71927),
    ("5033f343-bc65-40c4-ab5c-683edef57820", "stle88", 71927),
]

# Add GhostFace for preview
GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
PREVIEW = [
    (GHOSTFACE_ID, "GhostFace", 71927),  # Preview with same amount
]

def create_pm(user_id, username, points):
    """Create a PM/notification for the victim."""
    message = f"""You have been compensated with **{points:,} points**.

A player (Zwischenzug) was caught botting and permanently banned by System AI. Their wealth was confiscated and redistributed to victims.

You were identified as one of 5 players affected. Your share of the confiscated points has been added to your account.

See Topic of Shame for full details."""

    # Create as notification
    notif = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "system_ai_compensation",
        "title": "Point Compensation",
        "message": message,
        "created_at": now_iso,
        "read": False,
        "from_system_ai": True,
        "avatar_url": SAI_AVATAR,
    }
    
    db.notifications.insert_one(notif)
    return notif["id"]

# Send to GhostFace first (preview)
print("=== SENDING PREVIEW TO GHOSTFACE ===")
for user_id, username, points in PREVIEW:
    notif_id = create_pm(user_id, username, points)
    print(f"  ✓ {username}: +{points:,} points - Notification ID: {notif_id}")

print("\n=== SENDING TO VICTIMS ===")
for user_id, username, points in VICTIMS:
    notif_id = create_pm(user_id, username, points)
    print(f"  ✓ {username}: +{points:,} points - Notification ID: {notif_id}")

print("\n✓ All PMs sent!")
