"""Find Topic of Shame and link Piece to Zwischenzug by IP."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Find all forum categories
print("=== ALL FORUM CATEGORIES ===")
cats = list(db.forum_categories.find({}, {"name": 1, "id": 1, "_id": 1, "slug": 1}))
for c in cats:
    print(f"  {c.get('name', 'N/A')} - ID: {c.get('id', c.get('_id'))} - Slug: {c.get('slug', 'N/A')}")

# Find Topic of Shame by looking at threads
print("\n=== THREADS WITH 'SHAME' ===")
shame_threads = list(db.forum_threads.find({"title": {"$regex": "shame", "$options": "i"}}).limit(5))
for t in shame_threads:
    print(f"  {t.get('title')} - ID: {t.get('id', t.get('_id'))}")

# Check Piece account IPs
print("\n=== PIECE ACCOUNT DETAILS ===")
piece = db.users.find_one({"username": "Piece"})
if piece:
    print(f"ID: {piece.get('id')}")
    print(f"Last Login IP: {piece.get('last_login_ip', 'N/A')}")
    print(f"Registration IP: {piece.get('registration_ip', 'N/A')}")
    print(f"Known IPs: {piece.get('known_ips', [])}")
    piece_ips = set()
    if piece.get('last_login_ip'):
        piece_ips.add(piece.get('last_login_ip'))
    if piece.get('registration_ip'):
        piece_ips.add(piece.get('registration_ip'))
    piece_ips.update(piece.get('known_ips', []))
    
    # Zwischenzug IPs
    zwisch = db.users.find_one({"username": "Zwischenzug"})
    zwisch_ips = set()
    if zwisch.get('last_login_ip'):
        zwisch_ips.add(zwisch.get('last_login_ip'))
    if zwisch.get('registration_ip'):
        zwisch_ips.add(zwisch.get('registration_ip'))
    zwisch_ips.update(zwisch.get('known_ips', []))
    
    print(f"\nPiece IPs: {piece_ips}")
    print(f"Zwischenzug IPs: {zwisch_ips}")
    
    # Check overlap
    overlap = piece_ips & zwisch_ips
    if overlap:
        print(f"\n🔗 MATCHING IPs: {overlap}")
    else:
        print("\nNo direct IP match, checking IP prefix (same network)...")
        for pip in piece_ips:
            for zip in zwisch_ips:
                if pip and zip:
                    # Check if same /48 for IPv6
                    if ':' in pip and ':' in zip:
                        pip_prefix = ':'.join(pip.split(':')[:3])
                        zip_prefix = ':'.join(zip.split(':')[:3])
                        if pip_prefix == zip_prefix:
                            print(f"  Same network: {pip} ~ {zip}")

# Check banned IPs collection
print("\n=== BANNED IPS ===")
banned = list(db.banned_ips.find({}).limit(10))
for b in banned:
    print(f"  {b.get('ip')} - Reason: {b.get('reason', 'N/A')[:50]}")
