"""
Seed script: creates a "FAQs" forum topic from FORUM_FAQ.md (or fallback text).
Run from backend dir: python seed_faq_topic.py
Reads FORUM_FAQ.md from project root (parent of backend). Uses first user in DB as author.
Skips if a topic with title "FAQs" already exists.
"""
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
except ModuleNotFoundError as e:
    print("Missing dependency. Install with: pip install pymongo python-dotenv")
    sys.exit(1)

ROOT_DIR = Path(__file__).parent  # backend/
PROJECT_ROOT = ROOT_DIR.parent    # project root (where FORUM_FAQ.md lives)
load_dotenv(ROOT_DIR / ".env")

FAQ_TITLE = "FAQs"
FAQ_MD_PATH = PROJECT_ROOT / "FORUM_FAQ.md"

FALLBACK_FAQ_CONTENT = """What does each feature do? (Normal player features only.)

——— RANKS (by rank points) ———
Your rank unlocks crimes, GTA locations, and other content. Earn rank points from crimes, GTA, jail busts, OC heists, and kills.
• Rat (0) → Street Thug (250) → Hustler (1k) → Goon (3k) → Made Man (6k) → Capo (12k) → Underboss (24k) → Consigliere (50k) → Boss (100k) → Don (200k) → Godfather (400k, top).

——— WEALTH RANKS (by cash on hand) ———
Displayed on your profile; based only on how much cash you’re carrying.
• Broke ($0) → Bum ($1) → Very Poor ($50k) → Poor ($200k) → Rich ($500k) → Millionaire ($1M) → Extremely Rich ($2M) → Multi Millionaire ($10M) → Billionaire ($1B) → Multi Billionaire ($10B) → Trillionaire ($1T) → Multi Trillionaire ($10T).

——— TRAVEL & AIRPORT MILES ———
• Travels per hour: You get 15 travels per hour by default. Each trip (by car or airport) uses one travel.
• Extra airmiles: Buy 5 extra travels per hour from the Store for 25 points (stacks with your base 15).
• Airport: One airport slot per city (e.g. Chicago, New York, Las Vegas, Atlantic City). If no one owns it, travel costs 10 points. Owners can set 0–50 points per travel and earn when others use their airport. You can only own one property (airport or bullet factory) at a time.
• Travel by car: Uses travel time (seconds) based on car rarity; common ~45s, rare less, airport instant.

——— BOOZE RUN LIMITS ———
• Capacity: Base 50 units at rank 1; each rank adds +25 (e.g. rank 5 = 50 + 4×25 = 150). You can buy extra capacity in the Store: +100 units for 30 points per purchase, up to 1000 bonus capacity total.
• Prices: Six booze types (Bathtub Gin, Moonshine, Rum Runner’s Rum, Speakeasy Whiskey, Needle Beer, Jamaica Ginger). Buy/sell prices rotate every 3 hours per city.
• Risk: Each buy or sell has a 2–6% chance of getting you busted (20 seconds in jail).

——— BULLET FACTORY ———
• One factory per city (state). It always produces 3,000 bullets per hour, capped at 24 hours of accumulation (72,000 bullets) if uncollected.
• Unowned: Anyone can buy at a random price between $2,500 and $4,000 per bullet. No owner = no one sets the price.
• Claim: Cost $5,000,000 to claim a factory in your current city. You may only own one property (bullet factory or airport). Owner can set price per bullet ($1–$100,000) and collect the cash when others buy. Owner collects accumulated bullets as cash when they “collect”.

——— GARAGE BATCH LIMIT ———
• Melting cars for cash or bullets is done in batches. Default batch limit: 6 cars per action.
• Store upgrade: +10 to batch limit per purchase for 25 points (e.g. 6 → 16 → 26). Maximum batch limit is 100.

——— BODYGUARDS ———
• Slots: First slot is free; extra slots cost 100, 200, 300, 400 points in order.
• Armour upgrades: Improve bodyguard armour (0→1→2→3→4→5) with points: 50, 100, 200, 400, 800. Better armour = they absorb more bullets in attacks.

——— BANK ———
• Transfers: Send cash to any player (case-insensitive username).
• Interest: Deposit cash for 3h (0.5%), 6h (1.2%), 12h (2.5%), 24h (5%), 48h (12%), or 72h (20%). Longer = better rate. Withdraw when the term ends.
• Swiss limit: There is a cap on how much you can deposit (starts at $50M); check the Bank page.

——— DASHBOARD ———
• Dashboard: Your home screen. Quick links to crimes, GTA, jail, ranking, and other areas.

——— PROFILE & ACCOUNT ———
• Profile: View your (or another player’s) stats, rank, wealth rank, crew, kills, jail busts, honours, and avatar. On your own profile: change avatar, open Profile settings (gear icon) to turn notifications on/off (E-Games, OC invites, attacks, system, messages) and change your password.
• Inbox: Notifications and direct messages. Reply, start threads, mark as read.

——— RANKING & PROGRESSION ———
• Ranking: Compare with others. Includes Crimes, GTA, Jail, and Organised Crime.
• Crimes: Earn cash and rank points. Cooldowns and success chance; higher rank unlocks harder crimes.
• GTA: Steal vehicles. Locations unlock by rank (e.g. Street Parking at Goon, Private Estate at Consigliere). Each has success rate, jail time on fail, and cooldown. Cars go to Garage.
• Garage: Manage stolen cars. Melt for cash or bullets (batch limit applies), or use to travel.
• Jail: See who’s in jail. Bust others (or NPCs) for rank points; fail = short jail time. Failing crimes or GTA can land you in jail.
• Organised Crime: Team heists (Driver, Weapons, Explosives, Hacker). Create/invite/run. 6h or 4h cooldown (4h if you bought the OC timer in Store).

——— COMBAT & PROTECTION ———
• Attack: Search by username, then attack. Outcome depends on weapons, armour, bodyguards. Earn cash (25% of victim’s cash) and rank points.
• Attempts: Log of your attacks and attacks on you.
• Hitlist: Place bounties (cash or points) on players or their bodyguards. Others claim by killing. Buy off bounties (your own or others’) for cost.
• Bodyguards: Hire players or robots. Slot and armour costs above.

——— CREW & PROPERTY ———
• Families: Join or view crews. Run rackets together; cooldowns and payouts vary by racket.
• Properties: Airports and bullet factories. One per player. Earn points (airport) or cash (bullet factory); can be attacked.
• My Properties: Manage your airport or bullet factory (transfer, set price, etc.).
• Travel: Move between cities. Car or airport; travels per hour and extra airmiles above.
• States: Map and current city (Chicago, New York, Las Vegas, Atlantic City).

——— CASINO & GAMBLING ———
• Casino: Dice, Roulette, Blackjack, Horseracing. City-based; player-owned tables set max bet and earn house edge.
• Dice / Roulette / Blackjack / Horseracing: Play or own. Ownership = one per player across all cities (e.g. one dice table).
• Sports Betting: Bet on sports (when events available).
• E-Games (Forum → Entertainer): Community dice or gbox games; winners get random rewards (cash, points, bullets, cars).

——— GEAR & MONEY ———
• Armour & Weapons: Buy weapons (attacks) and armour levels (reduce bullets to kill). Rank and previous purchases can gate items. Daily events can make them 50% off or 10% more.
• Bank: See above (transfers, interest, Swiss limit).
• Store: Points for premium rank bar, silencer, OC timer (4h heist cooldown), garage batch upgrade, booze capacity, bullet packs, custom car name.
• Quick Trade: Buy/sell with other players (e.g. casino tables, cars) for points.
• Booze Run: Buy booze in one city, sell in another. Capacity and prices above.

——— OTHER ———
• Users Online: Who’s online; hover for profile preview.
• Leaderboard: Top by kills, crimes, GTA, jail busts.
• Stats: Your stats (kills, crimes, GTA, vehicles, etc.).
• Forum: General + Entertainer (E-Games). Create topics, reply, like.
• Dead/Alive: If your account is dead, use Dead > Alive from a new account to receive 5% of that account’s money and points once (dead account password required).
"""


def _markdown_bold_to_html(content: str) -> str:
    """Convert **bold** to <strong>bold</strong> so forum HTML renderer shows bold correctly."""
    import re
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_faq_content() -> str:
    """Load FAQ body from FORUM_FAQ.md if present, else use fallback text."""
    if FAQ_MD_PATH.exists():
        try:
            content = FAQ_MD_PATH.read_text(encoding="utf-8")
            if content.strip():
                return _markdown_bold_to_html(content.strip())
        except Exception as e:
            print(f"Warning: could not read {FAQ_MD_PATH}: {e}. Using fallback.")
    return _markdown_bold_to_html(FALLBACK_FAQ_CONTENT.strip())


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB", "mafia")
    db = client[db_name]

    existing = db.forum_topics.find_one({"title": FAQ_TITLE})
    if existing:
        print(f"Topic '{FAQ_TITLE}' already exists. Skipping.")
        return

    user = db.users.find_one({}, {"_id": 0, "id": 1, "username": 1})
    author_id = user["id"] if user else "system"
    author_username = user.get("username", "Game") if user else "Game"

    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    faq_content = _load_faq_content()
    doc = {
        "id": topic_id,
        "title": FAQ_TITLE,
        "content": faq_content,
        "category": "general",
        "author_id": author_id,
        "author_username": author_username,
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": True,
        "is_locked": False,
    }
    db.forum_topics.insert_one(doc)
    source = "FORUM_FAQ.md" if FAQ_MD_PATH.exists() else "fallback text"
    print(f"Created forum topic '{FAQ_TITLE}' (id={topic_id}, author={author_username}, content from {source}, sticky & important).")


if __name__ == "__main__":
    main()
