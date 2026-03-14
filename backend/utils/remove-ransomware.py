#!/usr/bin/env python3
"""
Remove Ransomware Notes from Database
Run this to clean up ransomware messages left in your collections
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def remove_ransomware():
    print("\n" + "="*70)
    print("🧹 RANSOMWARE REMOVAL TOOL")
    print("="*70 + "\n")
    
    # Connect to MongoDB
    mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.environ.get('DB_NAME', 'mafia_game')
    
    print(f"📍 Connecting to: {mongo_url.split('@')[-1] if '@' in mongo_url else mongo_url}")
    print(f"📊 Database: {db_name}\n")
    
    try:
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        
        # Get all collections
        collections = await db.list_collection_names()
        
        if not collections:
            print("⚠️  Database is empty - nothing to clean")
            client.close()
            return
        
        print(f"🔍 Scanning {len(collections)} collections for ransomware notes...\n")
        
        total_removed = 0
        found_in_collections = []
        
        for coll_name in collections:
            # Search for ransomware patterns
            ransomware_docs = await db[coll_name].find({
                "$or": [
                    {"content": {"$regex": "backed up.*BTC", "$options": "i"}},
                    {"content": {"$regex": "DBCODE", "$options": "i"}},
                    {"content": {"$regex": "onionmail", "$options": "i"}},
                    {"content": {"$regex": "bc1q.*mdb", "$options": "i"}},
                ]
            }).to_list(100)
            
            if ransomware_docs:
                found_in_collections.append(coll_name)
                print(f"🚨 Found {len(ransomware_docs)} ransomware note(s) in '{coll_name}':")
                
                for doc in ransomware_docs:
                    doc_id = doc.get('_id')
                    content_preview = doc.get('content', '')[:80]
                    print(f"   • ID: {doc_id}")
                    print(f"     Preview: {content_preview}...")
                    
                    # Ask for confirmation
                    print(f"\n   ⚠️  Delete this document? (y/n): ", end='')
                    response = input().strip().lower()
                    
                    if response == 'y':
                        result = await db[coll_name].delete_one({"_id": doc_id})
                        if result.deleted_count > 0:
                            print(f"   ✅ Deleted from '{coll_name}'")
                            total_removed += 1
                        else:
                            print(f"   ❌ Failed to delete")
                    else:
                        print(f"   ⏭️  Skipped")
                    print()
        
        client.close()
        
        print("\n" + "="*70)
        print(f"✅ Cleanup Complete - Removed {total_removed} ransomware note(s)")
        if found_in_collections:
            print(f"   Collections cleaned: {', '.join(found_in_collections)}")
        print("="*70 + "\n")
        
        if total_removed > 0:
            print("💡 Next Steps:")
            print("   1. Secure your MongoDB (enable authentication)")
            print("   2. Use firewall to block external access")
            print("   3. Set up automated backups")
            print("   4. Read: DIGITALOCEAN_MIGRATION_GUIDE.md")
            print()
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("\nMake sure:")
        print("  1. MongoDB is running")
        print("  2. .env file has correct credentials")
        print("  3. You have permission to delete documents")
        print()

if __name__ == "__main__":
    asyncio.run(remove_ransomware())
