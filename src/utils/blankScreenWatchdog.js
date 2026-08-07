/**
 * iOS Safari often discards background tabs. On return the radio can still be asleep,
 * so the JS bundle/lazy chunks fail and players see a blank page until they refresh
 * enough times for networking to come up.
 *
 * This watchdog: after a wake from background, if #root never paints app chrome,
 * soft-resume once, then do a single controlled reload (with cooldown).
 */

const RELOAD_KEY = 'blank_screen_reload_at';
const RELOAD_COOLDOWN_MS = 45_000;
const MIN_HIDDEN_MS = 12_000;
const CHECK_AFTER_VISIBLE_MS = 3_500;
const HARD_RELOAD_AFTER_SOFT_MS = 2_800;

let hiddenAt = null;
let checkTimer = null;
let hardReloadTimer = null;
let started = false;

function hasAppShell() {
  try {
    const root = document.getElementById('root');
    if (!root) return false;
    if (root.querySelector('[data-app-shell="1"]')) return true;
    if (root.querySelector('.App')) {
      // App wrapper exists — require some real painted content (not just empty Suspense).
      const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 24) return true;
      if (root.querySelector('nav, header, main, [data-testid], .mobile-page-root')) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function canHardReload() {
  try {
    const last = sessionStorage.getItem(RELOAD_KEY);
    const now = Date.now();
    if (last && now - parseInt(last, 10) < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch (_) {
    return true;
  }
}

function whenOnline(fn) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const onOnline = () => {
      window.removeEventListener('online', onOnline);
      setTimeout(fn, 600);
    };
    window.addEventListener('online', onOnline);
    return;
  }
  fn();
}

function softResume() {
  try {
    window.dispatchEvent(new CustomEvent('app:refresh-user', { detail: { resume: true } }));
    window.dispatchEvent(new CustomEvent('app:page-resume', { detail: { blankWatchdog: true } }));
  } catch (_) { /* ignore */ }
}

function scheduleHardReload() {
  if (hardReloadTimer) clearTimeout(hardReloadTimer);
  hardReloadTimer = setTimeout(() => {
    hardReloadTimer = null;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (hasAppShell()) return;
    if (!canHardReload()) return;
    whenOnline(() => {
      if (document.hidden || hasAppShell()) return;
      try {
        window.location.reload();
      } catch (_) { /* ignore */ }
    });
  }, HARD_RELOAD_AFTER_SOFT_MS);
}

function runBlankCheck() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (hasAppShell()) return;
  softResume();
  scheduleHardReload();
}

function onBecameVisible({ force = false } = {}) {
  const t0 = hiddenAt;
  hiddenAt = null;
  const hiddenFor = t0 ? Date.now() - t0 : 0;
  // Only after a real background stretch (or forced bfcache restore).
  if (!force && hiddenFor < MIN_HIDDEN_MS) return;

  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = null;
    whenOnline(runBlankCheck);
  }, CHECK_AFTER_VISIBLE_MS);
}

/**
 * Call once from index.js. Safe to call multiple times.
 */
export function startBlankScreenWatchdog() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.visibilityState === 'hidden') {
      if (!hiddenAt) hiddenAt = Date.now();
      return;
    }
    onBecameVisible();
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // Frozen tree restored — if it's somehow empty, recover.
      onBecameVisible({ force: true });
    }
  });

  window.addEventListener('online', () => {
    if (document.hidden) return;
    if (hasAppShell()) return;
    whenOnline(runBlankCheck);
  });
}
