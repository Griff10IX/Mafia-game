# Admin / moderator API enforcement

## Server helpers

Defined in [`server.py`](server.py):

- **`ADMIN_EMAILS`** – comma-separated env list (`ADMIN_EMAILS`); lowercased for compares.
- **`MOD_EMAILS`** – same for moderators (`MOD_EMAILS` or alias **`MODERATOR_EMAILS`**). Email on this list is treated as **`_is_moderator`** even if `is_moderator` is not set in MongoDB.
- **`_is_admin(user)`** – listed `ADMIN_EMAILS` user **and** not using “act as normal”.
- **`_is_moderator(user)`** – `is_moderator` on the user document **or** email on **`MOD_EMAILS`**.
- **`_admin_or_mod(user)`** – either of the above.
- **`require_admin`** – FastAPI dependency: `403` unless `_is_admin`.
- **`require_admin_or_mod`** – FastAPI dependency: `403` unless `_admin_or_mod`.
- **`require_admin_verified`** – Same as **`require_admin`** but chains **`get_current_user_verified`** (email verification gate for normal players).
- **`require_admin_or_mod_verified`** – Same as **`require_admin_or_mod`** with verified user — use for staff routes that already required **`get_current_user_verified`** (e.g. sports book admin read APIs).

General UI reads **`GET /auth/staff-flags`** (any signed-in user). The Admin Tools shell may also call **`GET /admin/check`** (**`require_admin_or_mod`** + staff JWT). Presence endpoints unchanged. UI-only gating may still use **`user_has_admin_list_email`**; destructive routes must **not** rely on email alone without `_is_admin` unless explicitly intended.

## Manual regression checks

Use a Bearer token from each persona (`Authorization: Bearer <jwt>`). All paths are under `/api`.

1. **Normal player** – `POST /admin/lock-player?target_username=Someone` → **403** (or 404 if routed incorrectly; must not lock).
2. **Moderator** – `POST /admin/lock-player` → **200** (or validation 404). `GET /admin/investigate/user-profile?username=test` → **200**. `GET /admin/security/dashboard` → **403** (admin-only). `POST /admin/give-auto-rank` → **403** (admin-only).
3. **Full admin** – `POST /admin/give-auto-rank` → **200** (with valid user).
4. **Listed admin, “act as normal” on** – `_is_admin` is false → admin-only tools → **403**; `POST /admin/lock-player` stays **allowed** if still moderator or if act-as-normal only affects `_is_admin` (mods unchanged).

5. **MOD_EMAILS only** – account with email on `MOD_EMAILS` (and not on `ADMIN_EMAILS`, no `is_moderator` in DB) → **`_is_moderator`** is true → mod tools **200**, admin-only **403**; normal website login still **blocked** (use staff login) like admins/mods.

6. **Security dashboard** – `GET /admin/security/dashboard` → **403** for non-admin; **200** for full admin (`require_admin`).

## Implementation notes (recent)

- [`routers/admin/security_admin.py`](routers/admin/security_admin.py) uses **`Depends(require_admin)`** (replaces raw `ADMIN_EMAILS` membership).
- Hot paths in [`routers/admin/admin.py`](routers/admin/admin.py) use **`Depends(require_admin_or_mod)`** or **`Depends(require_admin)`** where applicable; **`POST /admin/test-lock-self`** is registered (was previously missing a route decorator).
- [`routers/money/booze_run.py`](routers/money/booze_run.py) admin booze config: **`require_admin`**.
- [`routers/kill/armoury.py`](routers/kill/armoury.py) `admin_add_bullets`: **`require_admin`**.
- [`utils/civilian_protection.py`](utils/civilian_protection.py) staff exemption uses **`user_has_admin_list_email`** (case-safe) instead of raw email list membership.

**Moderator-tier routes** (examples now on dependencies): [`routers/admin/investigate.py`](routers/admin/investigate.py), [`routers/kill/witness_statements.py`](routers/kill/witness_statements.py) (`/admin/witness-statements-*`), [`routers/game/entertainer_staff.py`](routers/game/entertainer_staff.py) `/admin/entertainer-dashboard`, [`routers/account/auto_rank.py`](routers/account/auto_rank.py) `/admin/auto-rank/user-inspect`, and sports book **read/diagnostic** admin endpoints in [`routers/casinos/sports_betting.py`](routers/casinos/sports_betting.py) (`require_admin_or_mod_verified`).

Other routers with `/admin/` handlers generally already call **`_is_admin`** / **`_admin_or_mod`** at the top; prefer migrating them to **`require_admin`** / **`require_admin_or_mod`** (or **`*_verified`** variants) when touching those files.
