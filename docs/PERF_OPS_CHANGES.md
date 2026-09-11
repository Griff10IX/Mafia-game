# Performance ops changes (live server)

Track infra/perf tweaks that are **not** app code, so we can undo them without digging through chat history.

Live host: `root@178.128.38.68` · app root: `/opt/mafia-app`

---

## 2026-09-11 — #1 Enable nginx gzip for JS / CSS / JSON

### Why
`gzip on` was set, but `gzip_types` (and related lines) were **commented out**. Nginx then only gzip’d HTML by default. JS/CSS left the origin uncompressed (~776KB + ~470KB + ~305KB for the entry assets). Cloudflare brotli often hid this on cache HIT; origin/MISS paths paid full size.

### What we changed
**File on server:** `/etc/nginx/nginx.conf` (http block, “Gzip Settings”)

| Setting | Before | After |
|--------|--------|--------|
| `gzip on;` | enabled | unchanged |
| `gzip_vary` | commented | `gzip_vary on;` |
| `gzip_proxied` | commented | `gzip_proxied any;` |
| `gzip_comp_level` | commented | `gzip_comp_level 6;` |
| `gzip_buffers` | commented | `gzip_buffers 16 8k;` |
| `gzip_http_version` | commented | `gzip_http_version 1.1;` |
| `gzip_types` | commented | uncommented (js/css/json/xml/…) |

Backup taken on server before edit:  
`/etc/nginx/nginx.conf.bak-pre-gzip-types-2026-09-11`

### How to verify
From the droplet (hitting **origin**, not only CF):

```bash
MAIN=$(ls -t /opt/mafia-app/build/static/js/main.*.chunk.js | head -1)
curl -sk -D - -o /tmp/gztest.bin -H 'Accept-Encoding: gzip' \
  "https://127.0.0.1/static/js/$(basename "$MAIN")" | tr -d '\r' | grep -iE 'Content-Encoding|Content-Type|Content-Length'
```

Expect `Content-Encoding: gzip` and a body much smaller than the raw file on disk.

**Verified 2026-09-11 after reload:**

| Asset | Raw on disk | Downloaded (gzip) |
|-------|-------------|-------------------|
| `main.e6d4f52e.chunk.js` | 776,111 | 163,618 (~21%) |
| `main.3d6c1b51.chunk.css` | 304,621 | 45,597 (~15%) |
| `index.html` | — | still gzip (was already) |

### How to revert (if you don’t like it)
On the live server:

```bash
# Option A — restore the pre-change backup
sudo cp /etc/nginx/nginx.conf.bak-pre-gzip-types-2026-09-11 /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx

# Option B — manually re-comment the gzip_* lines (keep `gzip on;` if you want)
# Then: sudo nginx -t && sudo systemctl reload nginx
```

This does **not** require a frontend rebuild or backend restart. Game logic / auth / DB are untouched.

### Risk
Low. Standard nginx compression. Browsers and Cloudflare understand gzip. No app code change.

### Related repo files
- Site vhost (no gzip here — gzip is http-level): `scripts/nginx-mafia-live.conf`
- Example HTTPS conf: `scripts/nginx-mafia-https.conf.example`

### One-command revert (live)
```bash
sudo cp /etc/nginx/nginx.conf.bak-pre-gzip-types-2026-09-11 /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx
```

---

## 2026-09-11 — #2 Lazy-load Layout (landing doesn’t pay for game shell)

### Why
`Layout` was a static import in `App.js`, so webpack put the full game chrome (~272KB Layout + ThemePicker, DeathScreen, FamilyCommandCenter, TutorialCoach, big lucide import, admin tool maps, etc.) into the **initial** `main` bundle. Visiting `/` (login) still downloaded and parsed that JS.

### What we changed
**File:** `src/App.js`

| Before | After |
|--------|--------|
| `import Layout from "./components/Layout";` | removed static import |
| — | `const Layout = lazy(() => import("./components/Layout"));` |
| `AuthenticatedShell` rendered `<Layout>` directly | wrapped in `<Suspense fallback={<PageLoader />}>` |

**Gameplay / backend:** unchanged. Auth, money, combat, ranks untouched.

### Backups (easy revert)
| Where | Path |
|-------|------|
| Repo copy (pre-change) | `docs/perf-backups/App.js.pre-lazy-layout-2026-09-11.js` |
| Live copy (pre-change) | `/opt/mafia-app/backups/App.js.pre-lazy-layout-2026-09-11.js` |

### How to revert

**Option A — restore backup file (no git needed):**
```bash
# Local
copy docs\perf-backups\App.js.pre-lazy-layout-2026-09-11.js src\App.js

# Or on live, then rebuild frontend
cp /opt/mafia-app/backups/App.js.pre-lazy-layout-2026-09-11.js /opt/mafia-app/src/App.js
cd /opt/mafia-app && npm run build   # then your usual deploy-after-pull / nginx static serve
```

**Option B — git (if committed):**
```bash
git checkout -- src/App.js
# then rebuild + deploy
```

### What you might notice after #2
- Landing/login should feel lighter (less JS on first load).
- First navigation into the game after login may show the existing skeleton (`PageLoader`) briefly while the Layout chunk downloads (then cached).

### Live result (after rebuild 2026-09-11)
- `main.*.chunk.js` gzip size dropped roughly **~164KB → ~82KB** (build report: `main.05b5322e.chunk.js` **81.54 KB** gzip).
- Layout and its chrome now live in a separate lazy chunk (loaded after auth).

### Risk
Medium for UI timing only (Suspense). Zero for gameplay math. Fully reversible via backup above.

### One-command revert (live source only — still need rebuild)
```bash
bash /opt/mafia-app/scripts/revert-perf-2-lazy-layout.sh
# then: cd /opt/mafia-app && bash scripts/deploy-after-pull.sh
```
Or copy the backup then rebuild:
```bash
cp /opt/mafia-app/backups/App.js.pre-lazy-layout-2026-09-11.js /opt/mafia-app/src/App.js
cd /opt/mafia-app && bash scripts/deploy-after-pull.sh
```

---

## 2026-09-11 — #3 Lazy themes-expanded + ThemePicker

### Why
`themes.js` statically imported `themes-expanded.js` (~100KB+ of studio colours/presets) into every first load. ThemePicker also pulled that graph when Layout loaded.

### What we changed
| File | Change |
|------|--------|
| `src/constants/themes.js` | Removed static import of `themes-expanded.js`. Core catalogs only at boot. Added `ensureExpandedThemesLoaded()` + `storedThemeNeedsExpandedCatalog()`. |
| `src/context/ThemeContext.js` | Restore `app_theme_boot` CSS snapshot first; if saved ids need expanded pack, dynamic-load then re-apply. |
| `src/components/Layout.js` | `ThemePicker` is `lazy()` and only mounted when open. |
| `src/components/ThemePicker.js` | Calls `ensureExpandedThemesLoaded()` when opened; builds preset categories after load. |

**Gameplay:** unchanged.

### Backups
| Where | Path |
|-------|------|
| Repo | `docs/perf-backups/themes.js.pre-lazy-expanded-2026-09-11.js` |
| Repo | `docs/perf-backups/ThemeContext.js.pre-lazy-expanded-2026-09-11.js` |
| Repo | `docs/perf-backups/Layout.js.pre-lazy-expanded-2026-09-11.js` |
| Repo | `docs/perf-backups/ThemePicker.js.pre-lazy-expanded-2026-09-11.js` |
| Live | `/opt/mafia-app/backups/*pre-lazy-expanded-2026-09-11.*` |

### How to revert
```bash
# Live one-shot
bash /opt/mafia-app/scripts/revert-perf-3-theme-lazy.sh
cd /opt/mafia-app && bash scripts/deploy-after-pull.sh
```

Or restore the four files from `docs/perf-backups/*pre-lazy-expanded-2026-09-11*` into `src/…` then rebuild.

### What you might notice
- Slightly smaller initial JS.
- First open of Theme Studio may pause briefly while `themes-expanded` chunk loads.
- Users on expanded-only colours: first paint uses last CSS boot snapshot, then exact catalog after load (avoids gold flash when possible).

### Live result (after rebuild 2026-09-11)
- `main` gzip **~81.5KB → ~72.5KB** (`main.391ded1c.chunk.js` **72.46 KB** gzip).
- `themes-expanded` / ThemePicker are separate lazy chunks (not in entry `main`).

### Risk
Medium for theme UI only. Zero gameplay. Fully revertible.

---

## 2026-09-11 — #4 Shared `/auth/me` bootstrap + deferred Layout polls

### Why
Login/layout/dashboard stampeded `GET /auth/me` (multiple calls in seconds). Layout also fired many chrome polls immediately, competing with first-page JS/data.

### What we changed
| File | Change |
|------|--------|
| `src/utils/authMeBootstrap.js` | **New.** `fetchAuthMe()` shares one in-flight request + ~2.5s fresh cache. `invalidateAuthMeBootstrap()` on logout. |
| `src/utils/api.js` | `invalidateApiCache()` also clears auth bootstrap. |
| `src/utils/dashboardSessionCache.js` | Prefetch uses `fetchAuthMe` instead of raw `/auth/me`. |
| `src/components/Layout.js` | `fetchData` + email-verify poll use `fetchAuthMe`. Deferred: notifications, war, online, helpdesk, update-log, flash, objectives, ranking, sports, travel warm, weed ready, page-locks, store flags; user refresh interval starts later. |

**Gameplay:** unchanged (same APIs, delayed chrome badges only).

### Backups
| Where | Path |
|-------|------|
| Repo | `docs/perf-backups/Layout.js.pre-auth-bootstrap-2026-09-11.js` |
| Repo | `docs/perf-backups/dashboardSessionCache.js.pre-auth-bootstrap-2026-09-11.js` |
| Repo | `docs/perf-backups/api.js.pre-auth-bootstrap-2026-09-11.js` |
| Repo | `docs/perf-backups/App.js.pre-auth-bootstrap-2026-09-11.js` (unchanged logic; kept for pair) |
| Live | `/opt/mafia-app/backups/*pre-auth-bootstrap-2026-09-11*` |
| New file remove on revert | `src/utils/authMeBootstrap.js` |

### How to revert
```bash
bash /opt/mafia-app/scripts/revert-perf-4-auth-bootstrap.sh
cd /opt/mafia-app && bash scripts/deploy-after-pull.sh
```

### Test
```bash
node scripts/test-perf-4-auth-bootstrap.js
```

### Risk
Medium for shell badge freshness (1–few seconds later). Zero gameplay math.

---

## 2026-09-11 — #5 Trim lucide-react barrel in Layout

### Why
`Layout.js` imported ~70 icons from the `lucide-react` **barrel**. CRA/webpack still pulls a large icon graph into the Layout chunk. Almost every imported icon is used; unused were only `Bell` / `Flame` (and a stray unused `Settings`). The win is **per-file** ESM imports, not dropping nav icons.

### What we changed
| File | Change |
|------|--------|
| `src/components/layoutLucideIcons.js` | **New** — re-exports only icons Layout needs via `lucide-react/dist/esm/icons/<name>` |
| `src/components/Layout.js` | Import icons from `./layoutLucideIcons` instead of `lucide-react` |

### Backups
| Where | Path |
|-------|------|
| Repo | `docs/perf-backups/Layout.js.pre-lucide-trim-2026-09-11.js` |
| Live | `/opt/mafia-app/backups/Layout.js.pre-lucide-trim-2026-09-11.js` |
| New file remove on revert | `src/components/layoutLucideIcons.js` |

### How to revert
```bash
bash /opt/mafia-app/scripts/revert-perf-5-lucide-trim.sh
cd /opt/mafia-app && bash scripts/deploy-after-pull.sh
```

### Test
```bash
node scripts/test-perf-5-lucide-trim.js
```

### Risk
Low. Same icons; only module path changes. If a path typo breaks an icon, nav glyphs go missing — revert script restores barrel import.

### Verified after deploy (2026-09-11)
Layout async chunk (id `97.*`):

| Build | Raw | Gzip (origin) |
|-------|-----|---------------|
| Pre-trim (`97.2c80f98c`) | 343,721 | ~80.7 KB |
| Post-trim (`97.abe4c721`) | 296,726 | ~70.6 KB |

~47 KB raw / ~10 KB gzip off the shell chunk (main stays ~72–75 KB gzip because Layout is already lazy).

---

## Series retest (2026-09-11, after #1–#5)

**Login:** normal player `AlCapone26cd3e46` (not admin / not GhostFace). `/api/auth/me` 200 in ~99 ms then ~42 ms.

**Origin gzip entry assets (landing / first paint):**

| Asset | Raw | Gzip |
|-------|-----|------|
| `93.*.chunk.js` (vendors entry) | 328,289 | 104,084 |
| `main.*.chunk.js` | 366,235 | 75,078 |
| `main.*.chunk.css` | 304,621 | 45,597 |

**Baseline before this series:** single `main` ~776 KB raw / ~164 KB gzip (no `gzip_types`), Layout+themes inside main.

**After series:** landing `main` ~75 KB gzip; Layout ~71 KB gzip loads only when authenticated; expanded themes stay in a separate ~210 KB gzip chunk until Theme Studio needs them; duplicate `/auth/me` bootstrap cut.

---

## Series status (2026-09-11)

| # | Change | Status |
|---|--------|--------|
| 1 | nginx gzip JS/CSS/JSON | live |
| 2 | Lazy Layout | live |
| 3 | Lazy themes-expanded + ThemePicker | live |
| 4 | Shared `/auth/me` + deferred Layout polls | live |
| 5 | Lucide per-file trim in Layout | live |
