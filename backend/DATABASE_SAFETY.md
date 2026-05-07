# Database safety guide

## Bulk wipe endpoints (removed from the admin API)

The following routes still exist for compatibility but **always return HTTP 410 Gone** with an explanatory `detail` string. They **no longer delete data**, even with a correct confirmation body. A compromised admin account cannot use them to wipe the game.

| Endpoint | Former behaviour |
|----------|------------------|
| `POST /api/admin/wipe-all-users` | Deleted all users and related collections |
| `POST /api/admin/database-fresh` | Emptied almost every collection and re-seeded |
| `POST /api/admin/wipe-all-families` | Removed all families / crew data |
| `POST /api/admin/cars/delete-all` | Deleted every row in `user_cars` |
| `POST /api/admin/drop-all-casinos-properties` | Unclaimed all casinos and properties globally |

**If you truly need a full reset:** use MongoDB backups, a staging environment, or a **controlled script** run with server/DB access—not the live admin panel.

---

## `init_game_data()` on server start

**Runs on server restart** – Currently only (re)initialises game config collections (e.g. crimes, weapons, properties). It does **not** delete user accounts.

**Never add `db.users.delete_many({})` (or similar) to this path.**

---

## How to reduce risk further

1. **Back up MongoDB regularly**  
   `mongodump --uri="..." --out=backup_$(date +%Y%m%d)`

2. **Restrict who is admin**  
   Use the **`ADMIN_EMAILS`** env list; add **staff portal password** (`STAFF_PORTAL_PASSWORD`) for a second factor on admin API calls.

3. **Monitor logs**  
   Admin actions and denials should appear in your normal application / HTTP logs.

---

## If data disappeared

1. Check whether someone ran **out-of-band** commands or restores (not these API routes).  
2. Review git history for changes to startup or maintenance scripts.  
3. Check for saved Postman/Insomnia requests that hit old tooling.  
4. Restore from the most recent **known-good backup**.

---

## Other bulk endpoints

Some endpoints still perform **scoped** bulk actions (e.g. clear searches, bodyguard maintenance). Treat them as sensitive; they are listed in admin docs and still require admin where enforced.
