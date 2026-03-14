# Codebase scan – recommendations

Quick scan of the repo for performance, security, maintainability, and quality. Prioritised by impact.

---

## High priority

### 1. **JWT secret in production**
- **Where:** `backend/server.py` line 46, `backend/security_middleware.py` line 53.
- **Issue:** Fallback `'your-secret-key-change-in-production'` is used when `JWT_SECRET_KEY` is unset. If deployed without setting the env var, tokens are signed with a known default.
- **Recommendation:** In production, fail startup if `JWT_SECRET_KEY` is missing or equals the placeholder (e.g. check in `main` or before mounting routes). Keep using env for the real secret.

### 2. **Shared formatting utilities (remove duplicate code)**
- **Where:** `formatMoney` (and similar) is defined in many places, e.g. Bank.js, VideoPokerPage.js, Dice.js, FamilyPage.js, BoozeRun.js, Layout.js, etc. (~20 files).
- **Issue:** Same logic duplicated; any change (e.g. currency, locale) must be done in many files.
- **Recommendation:** Add `src/utils/format.js` (or similar) with `formatMoney`, `formatDateTime`, and any other shared formatters. Import them in each page. Per your rule: “Only ever remove duplicate code” – this is the main duplicate to remove.

### 3. **Swallowed errors in Attack page**
- **Where:** `src/pages/Attack.js` – e.g. `catch (e) {}`, `catch (error) {}` in `load`, `refreshAttacks`, `fetchInflation`, etc.
- **Issue:** Network or API failures are invisible; harder to debug and no user feedback.
- **Recommendation:** At least log: `catch (e) { console.error('Attack fetch failed', e); }`. Prefer also setting an error state and/or a non-intrusive toast so the user knows something failed.

---

## Medium priority

### 4. **Console logging in production**
- **Where:** Several pages use `console.log` / `console.error` (e.g. Bank.js, Inbox.js, Jail.js, Crimes.js, Layout.js, ErrorBoundary.js).
- **Recommendation:** For production, either remove non-essential logs or use a small logger that no-ops (or sends to a service) when `NODE_ENV === 'production'`. Keep `console.error` in error boundaries or critical paths if you have no other reporting.

### 5. **React hook dependency comments**
- **Where:** Many `// eslint-disable-next-line react-hooks/exhaustive-deps` or `// eslint-disable-line react-hooks/exhaustive-deps` (e.g. Attack.js, Layout.js, Dashboard.js, Store.js, Jail.js).
- **Issue:** Disabling the rule can hide real bugs (stale closures, missing refetches).
- **Recommendation:** Where you keep the disable, add a one-line comment: why deps are omitted (e.g. “only run on mount”) or that you intentionally want the previous behaviour. Prefer fixing the dependency array (e.g. wrap callbacks in `useCallback` with correct deps) where feasible.

### 6. **MongoDB indexes**
- **Where:** Backend uses `find`, `find_one`, `count_documents` on `users`, `notifications`, `bank_deposits`, `families`, etc. No `createIndex` / `ensure_index` found in the scanned code.
- **Issue:** Unindexed queries (e.g. on `username`, `user_id`, `owner_id`) can slow down as data grows.
- **Recommendation:** Add a small startup or migration script that ensures indexes for hot paths, e.g. `users.username`, `users.id`, `notifications.user_id`, `bank_deposits.user_id`, `*.owner_id` where used in filters. Document required indexes in backend README or a short “Database” section.

### 7. **Frontend tests**
- **Where:** No `*.test.js` / `*.test.jsx` / `*.spec.js` under `src` in the scan.
- **Recommendation:** Introduce a test runner (e.g. Vitest or Jest) and add a few tests for: (1) shared utils (e.g. the new `formatMoney`), (2) critical API usage (e.g. auth, key game actions), (3) one or two high-traffic pages (e.g. Attack, Bank, Profile). Even a small suite will catch regressions and document behaviour.

---

## Lower priority

### 8. **Accessibility**
- **Where:** Some `aria-*` and `role=` usage exists; not every interactive element or image was checked.
- **Recommendation:** Audit main flows (login, navigation, forms, key actions). Ensure: buttons have accessible names (text or `aria-label`), images have `alt`, and focus order is sensible. Fix any issues found.

### 9. **Environment variables**
- **Where:** `.env` is gitignored; `.env.example` exists. Backend uses `MONGO_URL`, `DB_NAME`, `JWT_SECRET_KEY`, etc.
- **Recommendation:** Keep `.env` out of the repo. In backend (and frontend if needed), document every required and optional env var in README and/or `.env.example` with short comments. For production, fail fast if required vars (e.g. `JWT_SECRET_KEY`, `MONGO_URL`) are missing.

### 10. **Backend structure**
- **Where:** `server.py` is large; routers are split by domain.
- **Recommendation:** If `server.py` keeps growing, consider moving auth helpers, DB helpers, and shared middleware into dedicated modules (e.g. `auth.py`, `db_helpers.py`) and importing them in `server.py` to keep the entrypoint readable.

---

## Already in good shape

- **Security:** Passwords and hashing are server-side only; no raw passwords or secrets in frontend.
- **XSS:** No `dangerouslySetInnerHTML` or `eval` in the scanned frontend.
- **CORS / API:** API is behind a prefix; CORS and env-based config are present.
- **Rate limiting / anti-cheat:** `security.py` and middleware provide request checks and Telegram alerts.
- **Data loading:** Many pages already use `Promise.all` / parallel fetches; profile and bank have been optimised with parallel backend work.

---

## Summary

| Priority   | Action |
|-----------|--------|
| High      | Enforce JWT secret in production; add shared `formatMoney`/formatters and remove duplicates; stop swallowing errors in Attack.js (log + optional UI). |
| Medium    | Trim or gate console logs; document or fix eslint-disable for hooks; add MongoDB indexes for hot queries; add a small frontend test suite. |
| Lower     | Quick a11y pass; document env vars and fail fast in prod; optional refactor of `server.py` into smaller modules. |

If you tell me which area you want to tackle first (e.g. “shared format utils” or “JWT secret”), I can suggest concrete code changes file-by-file.
