/** Frontend routes that 403 while jailed and bounce to /crime/jail. */
export const JAIL_BLOCKED_FRONTEND_PATHS = [
  '/crime/crimes',
  '/crimes',
  '/crime/gta',
  '/gta',
  '/organised-crime',
  '/oc',
  '/money/booze-run',
  '/booze-run',
];

const JAIL_FLAG_KEY = 'mafia_client_jailed_v1';
const JAIL_BOOTSTRAP_CACHE_KEY = 'jail_bootstrap_cache_v1';

let _jailed = false;
let _jailUntilMs = 0;

function persistJailFlag() {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      JAIL_FLAG_KEY,
      JSON.stringify({ jailed: _jailed, until: _jailUntilMs || 0 }),
    );
  } catch (_) { /* ignore */ }
}

function readPersistedJail() {
  try {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(JAIL_FLAG_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    _jailed = !!parsed?.jailed;
    _jailUntilMs = Number(parsed?.until) || 0;
  } catch (_) { /* ignore */ }
}

function peekJailBootstrapJailed() {
  try {
    if (typeof window === 'undefined') return false;
    const raw = window.sessionStorage.getItem(JAIL_BOOTSTRAP_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.data?.status?.in_jail;
  } catch (_) {
    return false;
  }
}

readPersistedJail();

export function isJailBlockedFrontendPath(pathname) {
  const p = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  return JAIL_BLOCKED_FRONTEND_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function setClientJailed(jailed, jailUntil) {
  const next = !!jailed;
  let untilMs = 0;
  if (next && jailUntil) {
    const t = new Date(jailUntil).getTime();
    if (Number.isFinite(t)) untilMs = t;
  }
  _jailed = next;
  _jailUntilMs = next ? untilMs : 0;
  persistJailFlag();
}

export function isClientJailed() {
  if (_jailUntilMs && Date.now() >= _jailUntilMs) {
    if (_jailed) {
      _jailed = false;
      _jailUntilMs = 0;
      persistJailFlag();
    }
    return false;
  }
  if (_jailed) return true;
  if (peekJailBootstrapJailed()) return true;
  try {
    if (typeof window === 'undefined') return false;
    const raw = window.sessionStorage.getItem(JAIL_FLAG_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.jailed) {
      const until = Number(parsed?.until) || 0;
      if (until && Date.now() >= until) return false;
      _jailed = true;
      _jailUntilMs = until;
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

export function jailBlockedPathFromHref(href) {
  if (!href || typeof href !== 'string') return null;
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
  try {
    const url = new URL(href, typeof window !== 'undefined' ? window.location.href : 'http://local.invalid');
    if (typeof window !== 'undefined' && url.origin !== window.location.origin) return null;
    if (isJailBlockedFrontendPath(url.pathname)) return url.pathname;
  } catch (_) { /* ignore */ }
  return null;
}
