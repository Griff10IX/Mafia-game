"""
FULL BAN EXECUTION: Zwischenzug (aka Piece)
- Strip all wealth
- Perm IP ban (IPv6 /48 block)
- Modkill account
- System AI announcements
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# === CONSTANTS ===
USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"
PIECE_ID = "8554e78f-c388-4cc2-9d47-1e505a1ade18"
IPV6_BLOCK = "2a01:4b00:b605:6000"  # /48 block to ban

# Evidence
BOT_FAILURES = 1298
FAILURES_PER_5_MIN = 1290
SWISS_BALANCE = 25_000_000_000
POINTS = 359_637

SAI_AVATAR = "/images/system-ai-profile.jpg?v=5"
SAI_COLOR = "#FBBF24"

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

print("=" * 60)
print("EXECUTING BAN: Zwischenzug (aka Piece)")
print("=" * 60)

# === 1. STRIP WEALTH ===
print("\n[1/5] Stripping all wealth...")
user = db.users.find_one({"id": USER_ID})
if user:
    wealth_before = {
        "cash": user.get("cash", 0),
        "swiss_balance": user.get("swiss_balance", 0),
        "crypto_balance": user.get("crypto_balance", 0),
        "points": user.get("points", 0),
    }
    print(f"  Before: Cash=${wealth_before['cash']:,} Swiss=${wealth_before['swiss_balance']:,} Crypto=${wealth_before['crypto_balance']:,} Points={wealth_before['points']:,}")
    
    db.users.update_one(
        {"id": USER_ID},
        {"$set": {
            "cash": 0,
            "swiss_balance": 0,
            "crypto_balance": 0,
            "points": 0,
            "kills": 0,
        }}
    )
    print(f"  ✓ Wealth stripped to $0")

# === 2. BAN ACCOUNT ===
print("\n[2/5] Banning account...")
db.users.update_one(
    {"id": USER_ID},
    {"$set": {
        "is_banned": True,
        "ban_reason": "Botting (1,298 automated attack attempts detected). Ban evasion (previously banned as 'Piece'). Permanent.",
        "banned_at": now_iso,
        "banned_by": "System AI",
        "is_dead": True,
        "death_reason": "Executed by System AI for botting",
        "death_time": now_iso,
    }}
)
print(f"  ✓ Account banned and killed")

# === 3. BAN IPv6 BLOCK ===
print("\n[3/5] Banning IPv6 network block...")
ip_ban_doc = {
    "ip": IPV6_BLOCK,
    "ip_type": "ipv6_prefix",
    "reason": f"Bot user Zwischenzug (previously Piece) - 1,298 automated attack attempts. Permanent ban.",
    "banned_at": now_iso,
    "banned_by": "System AI",
    "user_id": USER_ID,
    "username": USERNAME,
    "permanent": True,
}

# Check if already banned
existing_ban = db.banned_ips.find_one({"ip": IPV6_BLOCK})
if not existing_ban:
    db.banned_ips.insert_one(ip_ban_doc)
    print(f"  ✓ IPv6 block {IPV6_BLOCK}::/48 banned")
else:
    print(f"  ✓ IPv6 block already banned")

# === 4. REMOVE BOT TRAP ===
print("\n[4/5] Cleaning up bot trap...")
db.bot_traps.delete_one({"user_id": USER_ID})
print(f"  ✓ Bot trap removed")

# === 5. SYSTEM AI ANNOUNCEMENTS ===
print("\n[5/5] Posting System AI announcements...")

# Game chat announcement
CHAT_MESSAGE = f"""🤖 **AUTONOMOUS BOT DETECTION**

Player **Zwischenzug** (previously banned as 'Piece') has been permanently banned.

**Evidence:**
• 1,298 automated attack attempts blocked in under an hour
• 4.3 failed requests per second (impossible for human)
• Same network as previously banned account 'Piece'
• $25 billion in suspicious wealth confiscated

This was an autonomous decision by System AI. Bot detection traps caught this player attempting to automate kills. No victims were harmed - all attacks were blocked.

Play fair or get caught. 🎯"""

chat_doc = {
    "id": str(uuid.uuid4()),
    "user_id": "system_ai",
    "username": "System AI",
    "message": CHAT_MESSAGE,
    "family_id": None,
    "channel": "global",
    "created_at": now_iso,
    "expires_at": (now + timedelta(days=7)).isoformat(),
    "sender_is_staff": True,
    "system_ai": True,
    "avatar_url": SAI_AVATAR,
    "author_online_color": SAI_COLOR,
    "viewed_by": [],
    "pinned": True,
}
db.game_chat_messages.insert_one(chat_doc)
print(f"  ✓ Posted to global chat")

# Create Topic of Shame forum post
FORUM_TITLE = "🤖 Zwischenzug (aka Piece) - Botting & Ban Evasion"
FORUM_CONTENT = f"""## Autonomous Ban Report

**Player:** Zwischenzug
**Previous Identity:** Piece (previously banned)
**Ban Date:** {now.strftime('%B %d, %Y at %H:%M UTC')}
**Ban Type:** Permanent
**Banned By:** System AI (Autonomous Detection)

---

### Evidence

**Bot Detection Trap Results:**
- **1,298** failed attack attempts in under 1 hour
- **1,290** failures in just 5 minutes
- Average rate: **4.3 requests per second**
- Success rate: **0%** (all blocked by trap)

**Network Analysis:**
- IPv6 Network: `{IPV6_BLOCK}::/48`
- Same network as previously banned account "Piece"
- This constitutes ban evasion

**Wealth Confiscated:**
- Swiss Bank: $25,000,000,000
- Points: 359,637

---

### Technical Details

The bot trap system detected inhuman request patterns:
1. Requests arriving at mechanical intervals
2. No adaptation after failures (humans stop/refresh)
3. Continuous retries without reading error messages
4. Request rate physically impossible for manual clicking

---

### Verdict

This was an **autonomous decision** by System AI. The player was caught mid-botting by our trap system. No human players were harmed - all kill attempts were blocked before execution.

**Status:** Account banned, wealth stripped, IP block permanently banned.

*Play fair or get caught.* 🎯"""

# Find or create Topic of Shame category/thread
# First check if there's a staff/announcements category
staff_cat = db.forum_categories.find_one({"slug": {"$regex": "staff|announcement|shame", "$options": "i"}})
cat_id = staff_cat.get("id") if staff_cat else "announcements"

forum_post = {
    "id": str(uuid.uuid4()),
    "title": FORUM_TITLE,
    "content": FORUM_CONTENT,
    "author_id": "system_ai",
    "author_username": "System AI",
    "category_id": cat_id,
    "created_at": now_iso,
    "updated_at": now_iso,
    "is_pinned": True,
    "is_locked": True,
    "views": 0,
    "replies": 0,
    "system_ai": True,
    "avatar_url": SAI_AVATAR,
}
db.forum_threads.insert_one(forum_post)
print(f"  ✓ Posted to forum (Topic of Shame)")

print("\n" + "=" * 60)
print("BAN COMPLETE")
print("=" * 60)
print(f"""
Summary:
- Account: BANNED & KILLED
- Wealth: $25B CONFISCATED
- Points: 359K REMOVED
- IP Block: {IPV6_BLOCK}::/48 BANNED
- Chat: ANNOUNCED
- Forum: POSTED
- Victims: NONE (trap caught him first!)
""")
