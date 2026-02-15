#!/usr/bin/env python3
"""
Database Status & History Checker
Run this to see when your database was wiped and what collections exist
"""

import asyncio
import os
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def check_database():
    print("\n" + "="*70)
    print("🔍 DATABASE STATUS CHECK")
    print("="*70 + "\n")
    
    # Connect to MongoDB
    mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.environ.get('DB_NAME', 'mafia_game')
    
    print(f"📍 Connecting to: {mongo_url.split('@')[-1] if '@' in mongo_url else mongo_url}")
    print(f"📊 Database: {db_name}\n")
    
    try:
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        
        # List all collections
        collections = await db.list_collection_names()
        print(f"📦 Total Collections: {len(collections)}\n")
        
        if not collections:
            print("⚠️  WARNING: Database is EMPTY!\n")
            client.close()
            return
        
        # Count documents in each collection
        print("Collection Statistics:")
        print("-" * 70)
        
        total_docs = 0
        important_collections = []
        
        for coll_name in sorted(collections):
            count = await db[coll_name].count_documents({})
            total_docs += count
            
            # Check for timestamps in important collections
            if count > 0 and coll_name in ['users', 'families', 'security_flags', 'password_resets']:
                important_collections.append((coll_name, count))
                
                # Try to find oldest and newest documents
                oldest = await db[coll_name].find_one(
                    {}, 
                    sort=[('created_at', 1)]
                )
                newest = await db[coll_name].find_one(
                    {}, 
                    sort=[('created_at', -1)]
                )
                
                print(f"  📁 {coll_name:<30} {count:>8,} documents")
                
                if oldest and 'created_at' in oldest:
                    print(f"      ↳ Oldest: {oldest['created_at']}")
                if newest and 'created_at' in newest:
                    print(f"      ↳ Newest: {newest['created_at']}")
                print()
            else:
                print(f"  📁 {coll_name:<30} {count:>8,} documents")
        
        print("-" * 70)
        print(f"TOTAL: {total_docs:,} documents across {len(collections)} collections\n")
        
        # Check for ransomware note
        print("\n🔍 Checking for ransomware...")
        for coll_name in collections:
            try:
                ransomware = await db[coll_name].find_one({"content": {"$regex": "backed up.*BTC.*DBCODE", "$options": "i"}})
                if ransomware:
                    print(f"\n🚨 RANSOMWARE DETECTED in '{coll_name}' collection!")
                    print(f"   Message: {ransomware.get('content', '')[:100]}...")
                    print(f"   Document ID: {ransomware.get('_id')}")
                    
                    # Show when it was created (if available)
                    if 'created_at' in ransomware:
                        print(f"   ⏰ Created: {ransomware['created_at']}")
                    
                    print(f"\n   To remove: db.{coll_name}.deleteOne({{_id: ObjectId('{ransomware['_id']}')}});")
                    print()
            except:
                pass
        
        # Check security_flags for wipe events
        if 'security_flags' in collections:
            print("\n📋 Checking security logs...")
            flags = await db.security_flags.find({}).sort("created_at", -1).limit(10).to_list(10)
            if flags:
                print("\nRecent Security Events:")
                for flag in flags:
                    print(f"  • [{flag.get('created_at', 'N/A')}] {flag.get('flag_type')}: {flag.get('reason')}")
            else:
                print("  No security events logged")
        
        # Check for recent user creation (to determine when DB was reset)
        if 'users' in collections:
            print("\n👥 User Account Timeline:")
            user_count = await db.users.count_documents({})
            print(f"   Total Users: {user_count}")
            
            if user_count > 0:
                oldest_user = await db.users.find_one({}, sort=[('created_at', 1)])
                newest_user = await db.users.find_one({}, sort=[('created_at', -1)])
                
                if oldest_user and 'created_at' in oldest_user:
                    print(f"   First User Created: {oldest_user['created_at']} ({oldest_user.get('username')})")
                if newest_user and 'created_at' in newest_user:
                    print(f"   Latest User Created: {newest_user['created_at']} ({newest_user.get('username')})")
                
                # If oldest user is very recent, DB was likely wiped
                if oldest_user and 'created_at' in oldest_user:
                    oldest_time = datetime.fromisoformat(oldest_user['created_at'].replace('Z', '+00:00'))
                    hours_old = (datetime.now(oldest_time.tzinfo) - oldest_time).total_seconds() / 3600
                    
                    if hours_old < 24:
                        print(f"\n   ⚠️  All users created in last {hours_old:.1f} hours - DB may have been wiped recently!")
        
        client.close()
        
        print("\n" + "="*70)
        print("✅ Database check complete")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"\n❌ Error connecting to database: {e}")
        print("\nTroubleshooting:")
        print("  1. Is MongoDB running? sudo systemctl status mongod")
        print("  2. Check .env file has correct MONGO_URL")
        print("  3. If using auth, verify username/password are correct")
        print()

if __name__ == "__main__":
    asyncio.run(check_database())
