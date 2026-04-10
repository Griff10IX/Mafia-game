# 🚨 DATABASE SAFETY GUIDE

## ⚠️ DANGEROUS ENDPOINTS THAT CAN WIPE YOUR DATABASE

### 1. `/api/admin/wipe-all-users` (LINE 3772)
**EXTREMELY DANGEROUS** - Deletes ALL data from the database.

**Protection Added:**
- ✅ Now requires confirmation: `{"confirmation_text": "WIPE ALL DATA"}`
- ✅ Logs admin email and username who initiated the wipe
- ✅ Cannot be triggered accidentally

**Before Protection:**
```json
POST /api/admin/wipe-all-users
```

**After Protection:**
```json
POST /api/admin/wipe-all-users
{
  "confirmation_text": "WIPE ALL DATA"
}
```

---

### 2. `init_game_data()` Function (LINE 9833)
**Runs on EVERY server restart** - Currently only deletes `crimes` collection (safe), but could be modified accidentally.

**Current Behavior:**
- ✅ Only touches game config (crimes, weapons, properties)
- ✅ Does NOT touch user data
- ✅ Now has logging to show what's being initialized

**⚠️ NEVER add `db.users.delete_many({})` to this function!**

---

## 🛡️ HOW TO PREVENT DATABASE WIPES

### 1. **Backup Your Database Regularly**
```bash
# MongoDB backup command
mongodump --uri="your_mongo_uri" --out=backup_$(date +%Y%m%d)
```

### 2. **Restrict Admin Access**
Only emails listed in the **`ADMIN_EMAILS`** environment variable (comma-separated, case-insensitive) can call dangerous admin endpoints.

### 3. **Monitor Server Logs**
All dangerous operations now log with 🚨 emoji:
```
🚨 DATABASE WIPE initiated by admin@example.com (AdminUser)
🚨 DATABASE WIPE completed by admin@example.com: 15234 documents deleted
```

### 4. **Use Environment Variables**
Set `PRODUCTION=true` in production to disable certain dangerous endpoints.

---

## 🔍 WHAT COULD HAVE CAUSED YOUR DATABASE TO WIPE?

### Most Likely Causes:

1. **Accidental Admin Endpoint Call**
   - Someone with admin access called `/api/admin/wipe-all-users`
   - This is now protected with confirmation requirement

2. **Modified Startup Function**
   - If `init_game_data()` was modified to include more `delete_many({})` calls
   - Check git history for changes to this function

3. **Test Script**
   - A test script that calls the wipe endpoint
   - Check for any `.http`, `.rest`, or test files

4. **Third-party Tool**
   - API testing tool (Postman, Insomnia) with saved admin requests
   - Check for saved requests in these tools

---

## 📋 OTHER BULK DELETE ENDPOINTS (Less Dangerous)

| Endpoint | What It Deletes | Risk Level |
|----------|----------------|------------|
| `/admin/clear-all-searches` | All attack searches | 🟡 Medium |
| `/admin/bodyguards/drop-all` | All bodyguards | 🟡 Medium |
| `/admin/bodyguards/clear` | One user's bodyguards | 🟢 Low |
| `/admin/delete-user/{user_id}` | Single user + their data | 🟢 Low |

---

## 🔐 SECURITY BEST PRACTICES

1. **Never share admin credentials**
2. **Use database backups** (daily minimum)
3. **Enable MongoDB audit logs** to track who did what
4. **Use read-only database replicas** for reporting
5. **Test dangerous operations on a staging database first**

---

## 🆘 IF YOUR DATABASE WAS WIPED

1. **Check MongoDB backups** (if enabled)
2. **Check server logs** for who called the wipe endpoint
3. **Check git history** for unauthorized changes to `init_game_data()`
4. **Check API request logs** (if you have request logging enabled)
5. **Restore from backup** if available

---

## ✅ PROTECTIONS NOW IN PLACE

- ✅ Wipe endpoint requires explicit confirmation
- ✅ All dangerous operations are logged with admin identity
- ✅ Startup function has warnings about modifying it
- ✅ Clear documentation of what's dangerous

**Your database is now much safer!** 🛡️
